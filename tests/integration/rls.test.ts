// Proves tenant isolation and append-only rules at the DATABASE level (PRD §10.2, V01-E2E-06).
// Connects as oncosetu_app (DATABASE_URL_APP). Every case runs in a transaction that is rolled back.
//   npx vitest run tests/integration   (needs .env.local)
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres, { type TransactionSql } from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { ORG_GANGA_ID, ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 1, prepare: false, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
afterAll(async () => { await app.end(); await owner.end() })

class Rollback extends Error {}
async function inTx(sql: postgres.Sql, fn: (tx: TransactionSql) => Promise<void>) {
  await sql.begin(async (tx) => { await fn(tx); throw new Rollback() }).catch((e) => { if (!(e instanceof Rollback)) throw e })
}
const setOrg = (tx: TransactionSql, org: string) => tx`select set_config('app.org_id', ${org}, true)`
const insertPatient = (tx: TransactionSql, org: string, id = randomUUID()) =>
  tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc) values (${id}, ${org}, ${'t-' + id}, 'v1.x') returning id`
const code = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e) { return (e as { code?: string }).code } }

describe('RLS as oncosetu_app', () => {
  it('runs as a non-owner role without BYPASSRLS', async () => {
    const [r] = await app`select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as b`
    expect(r).toEqual({ u: 'oncosetu_app', b: false })
  })

  it('sees and writes nothing without app.org_id', async () => {
    await inTx(app, async (tx) => {
      expect(await code(insertPatient(tx, ORG_NARMADA_ID))).toBe('42501')
    })
    const [{ n }] = await app`select count(*)::int as n from patients`
    expect(n).toBe(0)
  })

  it('denies cross-org reads, updates and deletes', async () => {
    await inTx(app, async (tx) => {
      await setOrg(tx, ORG_GANGA_ID)
      const [b] = await insertPatient(tx, ORG_GANGA_ID)
      await setOrg(tx, ORG_NARMADA_ID)
      const [a] = await insertPatient(tx, ORG_NARMADA_ID)
      const visible = await tx`select id from patients where id in (${a.id}, ${b.id})`
      expect(visible.map((r) => r.id)).toEqual([a.id])
      expect((await tx`update patients set mrn = 'x' where id = ${b.id}`).count).toBe(0)
      expect((await tx`delete from patients where id = ${b.id}`).count).toBe(0)
      await setOrg(tx, ORG_GANGA_ID)
      expect((await tx`select id from patients where id = ${a.id}`).length).toBe(0)
      expect((await tx`select id from patients where id = ${b.id}`).length).toBe(1)
    })
  })

  it('denies writing a row into another org (WITH CHECK)', async () => {
    await inTx(app, async (tx) => {
      await setOrg(tx, ORG_NARMADA_ID)
      expect(await code(insertPatient(tx, ORG_GANGA_ID))).toBe('42501')
    })
    await inTx(app, async (tx) => {
      await setOrg(tx, ORG_NARMADA_ID)
      const [a] = await insertPatient(tx, ORG_NARMADA_ID)
      expect(await code(tx`update patients set org_id = ${ORG_GANGA_ID} where id = ${a.id}`)).toBe('42501')
    })
  })

  it('SECURITY DEFINER lookups return ids across orgs without exposing rows', async () => {
    await inTx(app, async (tx) => {
      await setOrg(tx, ORG_GANGA_ID)
      const [b] = await insertPatient(tx, ORG_GANGA_ID)
      await setOrg(tx, ORG_NARMADA_ID)
      const [hit] = await tx`select * from resolve_patient_by_token(${'t-' + b.id})`
      expect(hit).toEqual({ patient_id: b.id, org_id: ORG_GANGA_ID, token_revoked: false })
      expect((await tx`select id from patients where id = ${b.id}`).length).toBe(0)
    })
  })
})

describe('append-only tables', () => {
  it.each(['audit_log', 'verifications', 'consents', 'snapshots'])('app role cannot UPDATE or DELETE %s', async (table) => {
    await inTx(app, async (tx) => {
      await setOrg(tx, ORG_NARMADA_ID)
      expect(await code(tx`update ${tx(table)} set org_id = org_id where true`)).toBe('42501')
    })
    await inTx(app, async (tx) => {
      await setOrg(tx, ORG_NARMADA_ID)
      expect(await code(tx`delete from ${tx(table)} where true`)).toBe('42501')
    })
  })

  it('a trigger blocks UPDATE/DELETE on audit_log even for the owner', async () => {
    await inTx(owner, async (tx) => {
      const [row] = await tx`insert into audit_log (org_id, seq, at, actor_role, action, prev_hash, hash)
        values (${ORG_GANGA_ID}, -1, now(), 'system', 'test.probe', 'x', 'y') returning id`
      expect(await code(tx`update audit_log set action = 'tampered' where id = ${row.id}`)).toBe('42501')
    })
    await inTx(owner, async (tx) => {
      const [row] = await tx`insert into audit_log (org_id, seq, at, actor_role, action, prev_hash, hash)
        values (${ORG_GANGA_ID}, -1, now(), 'system', 'test.probe', 'x', 'y') returning id`
      expect(await code(tx`delete from audit_log where id = ${row.id}`)).toBe('42501')
    })
  })
})
