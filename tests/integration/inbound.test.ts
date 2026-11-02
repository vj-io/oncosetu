// Inbound channels at the DATABASE level (drizzle/0008): RLS + least-privilege grants on the new tables, the two public
// routing lookups, the erasure trigger, and the outbox sweeper (GET /api/cron/outbox) against real rows.
// Ganga org only; rolled back where possible, otherwise cleaned up by id.   npm run test:integration (needs .env.local)
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres, { type TransactionSql } from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb } from '../../src/db'
import { encryptField, hmac, phoneHmac } from '../../src/server/crypto'
import { ORG_GANGA_ID as ORG, ORG_NARMADA_ID } from '../../src/server/demo'
import { sweepOutbox } from '../../src/server/sms/sweep'
import type { SmsProvider } from '../../src/server/sms/provider'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 1, prepare: false, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
afterAll(async () => { await app.end(); await owner.end(); await closeDb() })

class Rollback extends Error {}
const rolledBack = (sql: postgres.Sql, fn: (tx: TransactionSql) => Promise<void>) =>
  sql.begin(async (tx) => { await fn(tx); throw new Rollback() }).catch((e) => { if (!(e instanceof Rollback)) throw e })
const setOrg = (tx: TransactionSql, org: string) => tx`select set_config('app.org_id', ${org}, true)`
const code = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e) { return (e as { code?: string }).code } }
const TABLES = ['contact_emails', 'inbound_aliases', 'inbound_holds', 'inbound_hold_files']

/** Patient + caregiver + a verified address for each + an alias + an open hold with one file. */
async function seed(tx: TransactionSql) {
  const [staff] = await tx`select id from staff where org_id = ${ORG} limit 1`
  const pid = randomUUID(), cid = randomUUID(), token = randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()
  await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc) values (${pid}, ${ORG}, ${'t-' + pid}, 'v1.x')`
  await tx`insert into caregivers (id, org_id, patient_id, name_enc, relation, phone_enc, phone_hmac) values (${cid}, ${ORG}, ${pid}, 'v1.x', 'son', 'v1.p', ${'ph-' + cid})`
  const own = hmac(`own-${pid}@example.com`), cg = hmac(`cg-${pid}@example.com`)
  await tx`insert into contact_emails (org_id, patient_id, email_enc, email_hmac, verified_by) values (${ORG}, ${pid}, 'v1.e', ${own}, ${staff.id})`
  await tx`insert into contact_emails (org_id, patient_id, caregiver_id, email_enc, email_hmac, verified_by) values (${ORG}, ${pid}, ${cid}, 'v1.e', ${cg}, ${staff.id})`
  await tx`insert into inbound_aliases (org_id, patient_id, alias_token) values (${ORG}, ${pid}, ${token})`
  const [hold] = await tx`insert into inbound_holds (org_id, patient_id, channel, sender_hmac, code_hash, expires_at) values (${ORG}, ${pid}, 'whatsapp', 'ph', 'c', now() + interval '10 minutes') returning id`
  await tx`insert into inbound_hold_files (org_id, patient_id, hold_id, mime, bytes_enc, dek_wrapped, size) values (${ORG}, ${pid}, ${hold.id}, 'application/pdf', ${Buffer.from('x')}, 'v1.d', 1)`
  return { pid, cid, token, own, cg, holdId: hold.id as string }
}

describe('inbound tables (0008)', { timeout: 60_000 }, () => {
  it('have RLS enabled and forced', async () => {
    const rows = await owner`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ${owner(TABLES)} order by relname`
    expect(rows).toEqual(TABLES.slice().sort().map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })))
  })

  it('are invisible to another org, and the app role can revoke but never delete an address or alias', async () => {
    await rolledBack(app, async (tx) => {
      await setOrg(tx, ORG)
      const s = await seed(tx)
      await setOrg(tx, ORG_NARMADA_ID)
      for (const t of TABLES) expect((await tx`select count(*)::int as n from ${tx(t)} where patient_id = ${s.pid}`)[0].n, t).toBe(0)
      await setOrg(tx, ORG)
      expect((await tx`select count(*)::int as n from inbound_hold_files where patient_id = ${s.pid}`)[0].n).toBe(1)
      await tx`savepoint s`
      expect(await code(tx`delete from contact_emails where patient_id = ${s.pid}`)).toBe('42501')
      await tx`rollback to savepoint s`
      expect(await code(tx`delete from inbound_aliases where patient_id = ${s.pid}`)).toBe('42501')
      await tx`rollback to savepoint s`
      expect(await code(tx`update contact_emails set email_hmac = 'x' where patient_id = ${s.pid}`)).toBe('42501')
      await tx`rollback to savepoint s`
      expect(await code(tx`update contact_emails set revoked_at = now() where patient_id = ${s.pid} and caregiver_id is null`)).toBe('ok')
    })
  })

  it('resolve_inbound_alias / resolve_contact_email return ids only, and skip revoked addresses and revoked caregivers', async () => {
    await rolledBack(app, async (tx) => {
      await setOrg(tx, ORG)
      const s = await seed(tx)
      await tx`select set_config('app.org_id', '', true)` // the webhooks call these with no org set
      expect(await tx`select * from resolve_inbound_alias(${s.token})`).toEqual([{ patient_id: s.pid, org_id: ORG }])
      expect(await tx`select * from resolve_contact_email(${s.cg})`).toEqual([expect.objectContaining({ patient_id: s.pid, org_id: ORG, caregiver_id: s.cid })])
      await setOrg(tx, ORG)
      await tx`update caregivers set active = false, revoked_at = now() where id = ${s.cid}`
      await tx`update contact_emails set revoked_at = now() where email_hmac = ${s.own}`
      await tx`update inbound_aliases set revoked_at = now() where patient_id = ${s.pid}`
      expect(await tx`select * from resolve_contact_email(${s.cg})`).toEqual([])
      expect(await tx`select * from resolve_contact_email(${s.own})`).toEqual([])
      expect(await tx`select * from resolve_inbound_alias(${s.token})`).toEqual([])
    })
  })

  it('a patient becoming `erased` clears its addresses, aliases and held files (they are PII)', async () => {
    await rolledBack(owner, async (tx) => {
      await setOrg(tx, ORG)
      const s = await seed(tx)
      await tx`update patients set status = 'erased' where id = ${s.pid}`
      for (const t of TABLES) expect((await tx`select count(*)::int as n from ${tx(t)} where patient_id = ${s.pid}`)[0].n, t).toBe(0)
    })
  })
})

describe('outbox sweeper', { timeout: 60_000 }, () => {
  it('re-delivers stale `queued` rows to the number recovered from the patient phone; no match → failed stale_no_recipient', async () => {
    const pid = randomUUID(), phone = `+9198${String(Date.now()).slice(-8)}`
    const ids = { match: randomUUID(), orphan: randomUUID(), fresh: randomUUID() }
    await owner`insert into patients (id, org_id, oncosetu_token_hash, name_enc, phone_enc, phone_hmac) values (${pid}, ${ORG}, ${'t-' + pid}, 'v1.x', ${encryptField(phone)}, ${phoneHmac(phone)})`
    const row = (id: string, toHmac: string, ago: string) =>
      owner`insert into outbox (id, org_id, patient_id, channel, to_masked, to_hmac, template_key, body, delivery, created_at)
        values (${id}, ${ORG}, ${pid}, 'sms', 'masked', ${toHmac}, 'test.sweep', 'hello', 'queued', now() - ${ago}::interval)`
    try {
      await row(ids.match, phoneHmac(phone)!, '10 minutes')
      await row(ids.orphan, 'no-such-hmac-' + pid, '10 minutes')
      await row(ids.fresh, phoneHmac(phone)!, '1 minute')
      const sent: { to: string; body: string }[] = []
      const fake: SmsProvider = { name: 'twilio', send: async (m) => { sent.push(m); return { providerMessageId: 'SMfake' } } }
      expect(await sweepOutbox([ORG], () => fake)).toEqual({ attempted: 1, failed: 1 })
      expect(sent).toEqual([{ to: phone, body: 'hello' }])
      const after = await owner`select id, delivery, provider_message_id, delivery_error from outbox where id in ${owner(Object.values(ids))}`
      const by = Object.fromEntries(after.map((r) => [r.id, r]))
      expect(by[ids.match]).toMatchObject({ delivery: 'sent', provider_message_id: 'SMfake', delivery_error: null })
      expect(by[ids.orphan]).toMatchObject({ delivery: 'failed', delivery_error: 'stale_no_recipient' })
      expect(by[ids.fresh]).toMatchObject({ delivery: 'queued' })
    } finally {
      await owner`delete from outbox where id in ${owner(Object.values(ids))}`
      await owner`delete from patients where id = ${pid}`
    }
  })
})
