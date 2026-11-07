// New tables (0014 privacy acknowledgements and ID checks, 0015 chunked uploads) against a live database as oncosetu_app:
// tenant isolation, the last-4-only constraint, erasure cleanup, and the chunk flow (join, bad checksum, resume, other uploader).
//   npx vitest run --project integration tests/integration/privacy-uploads.test.ts   (needs .env.local)
import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import postgres, { type TransactionSql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_GANGA_ID, ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 1, prepare: false, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })

class Rollback extends Error {}
async function inTx(sql: postgres.Sql, fn: (tx: TransactionSql) => Promise<void>) {
  await sql.begin(async (tx) => { await fn(tx); throw new Rollback() }).catch((e) => { if (!(e instanceof Rollback)) throw e })
}
const setOrg = (tx: TransactionSql, org: string) => tx`select set_config('app.org_id', ${org}, true)`
const newPatient = (tx: TransactionSql, org: string, id = randomUUID()) =>
  tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc) values (${id}, ${org}, ${'t-' + id}, 'v1.x') returning id`
const code = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e) { return (e as { code?: string }).code } }
const staffId = async () => (await owner`select id from staff where org_id = ${ORG_NARMADA_ID} limit 1`)[0].id as string

afterAll(async () => { await app.end(); await owner.end() })

describe('privacy acknowledgements and ID checks (0014)', () => {
  it('are visible only inside their own org', async () => {
    const sid = await staffId()
    await inTx(owner, async (tx) => {
      await setOrg(tx, ORG_NARMADA_ID)
      const [p] = await newPatient(tx, ORG_NARMADA_ID)
      await tx`insert into privacy_acknowledgements (org_id, patient_id, actor_type, actor_id, notice_version, language) values (${ORG_NARMADA_ID}, ${p.id}, 'patient', ${p.id}, 'dpdp-draft-v1', 'en')`
      await tx`insert into id_verifications (org_id, patient_id, id_type, last4, verified_by) values (${ORG_NARMADA_ID}, ${p.id}, 'aadhaar', '1234', ${sid})`
      await tx`select set_config('app.org_id', ${ORG_GANGA_ID}, true)`
      const set = tx.unsafe('set local role oncosetu_app')
      await set
      expect((await tx`select count(*)::int as n from privacy_acknowledgements`)[0].n).toBe(0)
      expect((await tx`select count(*)::int as n from id_verifications`)[0].n).toBe(0)
    })
  })

  it('the database itself refuses anything but 4 characters for the stored ID part', async () => {
    const sid = await staffId()
    for (const bad of ['123456789012', '12', '12 34', '12a4']) {
      await inTx(owner, async (tx) => {
        await setOrg(tx, ORG_NARMADA_ID)
        const [p] = await newPatient(tx, ORG_NARMADA_ID)
        expect(await code(tx`insert into id_verifications (org_id, patient_id, id_type, last4, verified_by) values (${ORG_NARMADA_ID}, ${p.id}, 'aadhaar', ${bad}, ${sid})`)).toBe('23514')
      })
    }
  })

  it('erasing a patient removes the masked ID record but keeps the acknowledgement', async () => {
    const sid = await staffId()
    await inTx(owner, async (tx) => {
      await setOrg(tx, ORG_NARMADA_ID)
      const [p] = await newPatient(tx, ORG_NARMADA_ID)
      await tx`insert into privacy_acknowledgements (org_id, patient_id, actor_type, actor_id, notice_version, language) values (${ORG_NARMADA_ID}, ${p.id}, 'patient', ${p.id}, 'dpdp-draft-v1', 'en')`
      await tx`insert into id_verifications (org_id, patient_id, id_type, last4, verified_by) values (${ORG_NARMADA_ID}, ${p.id}, 'pan', '12AF', ${sid})`
      await tx`update patients set status = 'erased' where id = ${p.id}`
      expect((await tx`select count(*)::int as n from id_verifications where patient_id = ${p.id}`)[0].n).toBe(0)
      expect((await tx`select count(*)::int as n from privacy_acknowledgements where patient_id = ${p.id}`)[0].n).toBe(1)
    })
  })

  it('the app role can add acknowledgements but not edit or delete them', async () => {
    await inTx(app, async (tx) => { await setOrg(tx, ORG_NARMADA_ID); expect(await code(tx`update privacy_acknowledgements set language = 'hi'`)).toBe('42501') })
    await inTx(app, async (tx) => { await setOrg(tx, ORG_NARMADA_ID); expect(await code(tx`delete from privacy_acknowledgements`)).toBe('42501') })
  })
})

describe('chunked uploads (0015)', () => {
  let pid: string
  const me = { kind: 'patient' as const, id: '' }
  beforeAll(async () => {
    pid = randomUUID()
    me.id = pid
    await owner.begin(async (tx) => { await setOrg(tx, ORG_NARMADA_ID); await newPatient(tx, ORG_NARMADA_ID, pid) })
  })
  afterAll(async () => {
    await owner.begin(async (tx) => {
      await setOrg(tx, ORG_NARMADA_ID)
      await tx`delete from upload_chunks where session_id in (select id from upload_sessions where patient_id = ${pid})`
      await tx`delete from upload_sessions where patient_id = ${pid}`
      await tx`delete from patients where id = ${pid}`
    })
  })

  const run = async <T>(fn: (tx: import('../../src/db').Tx) => Promise<T>): Promise<T> => (await import('../../src/db')).withOrg(ORG_NARMADA_ID, fn)

  it('joins chunks into the original file, and resumes after an interruption', async () => {
    const { startUpload, putChunk, uploadStatus, assemble, closeSession } = await import('../../src/server/uploads/chunks')
    const bytes = Buffer.alloc(9 * 1024 * 1024, 7)
    bytes.write('hello', 0)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const chunk = 3.5 * 1024 * 1024
    const parts = [0, 1, 2].map((i) => new Uint8Array(bytes.subarray(i * chunk, Math.min(bytes.length, (i + 1) * chunk))))
    const s = await run((tx) => startUpload(tx, { orgId: ORG_NARMADA_ID, patientId: pid, uploader: me, fileName: 'series.zip', totalSize: bytes.length, totalChunks: 3, sha256, intakeRoute: 'patient_link' }))
    await run((tx) => putChunk(tx, { sessionId: s.id, patientId: pid, uploader: me, orgId: ORG_NARMADA_ID, idx: 0, bytes: parts[0] }))
    await run((tx) => putChunk(tx, { sessionId: s.id, patientId: pid, uploader: me, orgId: ORG_NARMADA_ID, idx: 2, bytes: parts[2] }))
    expect((await run((tx) => uploadStatus(tx, s.id, pid, me))).have).toEqual([0, 2]) // the browser sees what is missing
    await expect(run((tx) => assemble(tx, s.id, pid, me))).rejects.toMatchObject({ code: 'chunks_missing' })
    await run((tx) => putChunk(tx, { sessionId: s.id, patientId: pid, uploader: me, orgId: ORG_NARMADA_ID, idx: 1, bytes: parts[1] }))
    const out = await run((tx) => assemble(tx, s.id, pid, me))
    expect(Buffer.from(out.bytes).equals(bytes)).toBe(true)
    await run((tx) => closeSession(tx, s.id, 'done'))
    const [{ n }] = await owner`select count(*)::int as n from upload_chunks where session_id = ${s.id}`
    expect(n).toBe(0) // chunks are gone once the file is assembled
  }, 60_000)

  it('refuses a file whose checksum does not match, and keeps the session so the bad chunk can be re-sent', async () => {
    const { startUpload, putChunk, assemble } = await import('../../src/server/uploads/chunks')
    const good = Buffer.from('a'.repeat(1000))
    const s = await run((tx) => startUpload(tx, { orgId: ORG_NARMADA_ID, patientId: pid, uploader: me, fileName: 'x.pdf', totalSize: good.length, totalChunks: 1, sha256: createHash('sha256').update(good).digest('hex'), intakeRoute: 'patient_link' }))
    await run((tx) => putChunk(tx, { sessionId: s.id, patientId: pid, uploader: me, orgId: ORG_NARMADA_ID, idx: 0, bytes: new Uint8Array(Buffer.from('b'.repeat(1000))) }))
    await expect(run((tx) => assemble(tx, s.id, pid, me))).rejects.toMatchObject({ status: 422, code: 'checksum_mismatch' })
    await run((tx) => putChunk(tx, { sessionId: s.id, patientId: pid, uploader: me, orgId: ORG_NARMADA_ID, idx: 0, bytes: new Uint8Array(good) })) // re-send replaces
    expect(Buffer.from((await run((tx) => assemble(tx, s.id, pid, me))).bytes).equals(good)).toBe(true)
  })

  it('another uploader cannot touch the session', async () => {
    const { startUpload, putChunk } = await import('../../src/server/uploads/chunks')
    const b = Buffer.from('c'.repeat(100))
    const s = await run((tx) => startUpload(tx, { orgId: ORG_NARMADA_ID, patientId: pid, uploader: me, fileName: 'y.pdf', totalSize: b.length, totalChunks: 1, sha256: createHash('sha256').update(b).digest('hex'), intakeRoute: 'patient_link' }))
    await expect(run((tx) => putChunk(tx, { sessionId: s.id, patientId: pid, uploader: { kind: 'patient', id: randomUUID() }, orgId: ORG_NARMADA_ID, idx: 0, bytes: new Uint8Array(b) }))).rejects.toMatchObject({ status: 404 })
  })
})
