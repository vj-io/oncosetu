// Originals in object storage (src/server/objects.ts, 0028): with a store configured, an uploaded study's original is kept as
// ciphertext in the store and the row holds no bytes; reading, previewing and processing get the same bytes back; a changed
// object is refused; the key is as immutable as the bytes; with no store, files stay in Postgres as before.
// An in-memory store stands in for the bucket here (the request signing is tested against AWS's examples in objects.test.ts, and a
// live smoke run against the real bucket is part of deploying). Synthetic files only. Needs .env.local.
import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { zipSync } from 'fflate'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const pid = randomUUID()
const objects = new Map<string, Uint8Array>()
const memStore = {
  async put(k: string, b: Uint8Array) { objects.set(k, new Uint8Array(b)) },
  async get(k: string) { const b = objects.get(k); if (!b) throw new Error('NoSuchKey'); return b },
  async del(k: string) { objects.delete(k) },
}
const ctx = async () => ({
  db: await import('../../src/db'), schema: await import('../../src/db/schema'), up: await import('../../src/server/pipeline/upload'),
  proc: await import('../../src/server/pipeline/process'), syn: await import('../../src/server/pipeline/dicom-synthetic'),
  crypto: await import('../../src/server/crypto'), files: await import('../../src/server/files'), objects: await import('../../src/server/objects'),
  study: await import('../../src/server/pipeline/study'),
})
const base = { orgId: ORG_NARMADA_ID, patientId: pid, uploadedBy: { kind: 'staff' as const, id: randomUUID() }, intakeRoute: 'bulk' as const }

beforeAll(async () => {
  const c = await ctx()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, sex) values (${pid}, ${ORG_NARMADA_ID}, ${'t-' + pid}, ${c.crypto.encryptField('Sunita Deshmukh')}, ${c.crypto.encryptField('1974-08-14')}, 'female')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG_NARMADA_ID}, ${pid}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
  })
})
afterEach(async () => (await ctx()).objects.setObjectStoreForTests(undefined))
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)`
    for (const t of ['evidence', 'events', 'missing_records', 'document_pages', 'document_files', 'documents']) await tx.unsafe(`delete from ${t} where patient_id = '${pid}'`)
    await tx`delete from audit_log where target_id = ${pid}`.catch(() => {})
    await tx.unsafe(`delete from consents where patient_id = '${pid}'`).catch(() => {})
  }).catch(() => {})
  await owner.end()
})

async function uploadStudy(uid: string) {
  const c = await ctx()
  const files: Record<string, Uint8Array> = {}
  for (let i = 1; i <= 3; i++) files[`MR/IM${i}`] = await c.syn.buildSyntheticDicom({ modality: 'MR', patientName: 'Deshmukh^Sunita', sex: 'F', age: '051Y', studyUid: uid, instance: i, size: 32 })
  const r = await c.db.withOrg(ORG_NARMADA_ID, (tx) => c.up.ingestUpload(tx, { ...base, fileName: 'cd.zip', bytes: zipSync(files) }))
  const id = r.documents[0].documentId
  for (const d of r.documents) if (d.status === 'queued') await c.proc.runDocument(d.documentId, ORG_NARMADA_ID)
  const [row] = await owner`select id, object_key, octet_length(bytes_enc) as n, sha256 from document_files where document_id = ${id} and kind = 'original'`
  return { c, id, row, files }
}

describe('originals in object storage', () => {
  it('keeps a study as ciphertext in the store, no bytes in the row, and gives back the same bytes to readers and processing', async () => {
    const c0 = await ctx()
    c0.objects.setObjectStoreForTests(memStore)
    const { c, id, row, files } = await uploadStudy('1.2.826.0.1.3680043.8.498.901')
    expect(row.object_key).toMatch(new RegExp(`^o/${ORG_NARMADA_ID}/[0-9a-f-]{36}$`))
    expect(row.n).toBe(0)
    const stored = objects.get(row.object_key)!
    expect(Buffer.from(stored).includes(Buffer.from('DICM'))).toBe(false) // only ciphertext leaves the server
    const file = await c.db.withOrg(ORG_NARMADA_ID, (tx) => c.files.readFile(tx, row.id))
    expect(createHash('sha256').update(file!.bytes).digest('hex')).toBe(row.sha256)
    expect(Buffer.from(c.study.bundleSliceAt(file!.bytes, 0).data!).equals(Buffer.from(files['MR/IM1']))).toBe(true)
    const [doc] = await owner`select status from documents where id = ${id}`
    expect(doc.status).toBe('done') // processing read the original back from the store
  }, 90_000)

  it('refuses an object that was changed in the store, and the key cannot be changed in the row', async () => {
    const c0 = await ctx()
    c0.objects.setObjectStoreForTests(memStore)
    const { c, row } = await uploadStudy('1.2.826.0.1.3680043.8.498.902')
    const b = objects.get(row.object_key)!
    b[b.length - 1] ^= 1
    await expect(c.db.withOrg(ORG_NARMADA_ID, (tx) => c.files.readFile(tx, row.id))).rejects.toThrow()
    await expect(owner`update document_files set object_key = 'o/elsewhere' where id = ${row.id}`).rejects.toThrow(/immutable/)
  }, 90_000)

  it('refuses to start an upload that would take object storage past its budget (so a free tier stays free)', async () => {
    const c = await ctx()
    c.objects.setObjectStoreForTests(memStore)
    const { startUpload } = await import('../../src/server/uploads/chunks')
    const start = (totalSize: number) => c.db.withOrg(ORG_NARMADA_ID, (tx) => startUpload(tx, {
      orgId: ORG_NARMADA_ID, patientId: pid, uploader: base.uploadedBy, fileName: 'cd.zip', totalSize, totalChunks: Math.ceil(totalSize / (3.5 * 1048576)),
      sha256: 'a'.repeat(64), intakeRoute: 'bulk',
    } as Parameters<typeof startUpload>[1]))
    const before = process.env.OBJECT_BUDGET_MB
    try {
      process.env.OBJECT_BUDGET_MB = '1' // 1 MB: a 2 MB upload does not fit
      await expect(start(2 * 1048576)).rejects.toMatchObject({ status: 507, code: 'storage_full' })
      process.env.OBJECT_BUDGET_MB = '100'
      await expect(start(2 * 1048576)).resolves.toMatchObject({ id: expect.any(String) })
    } finally {
      if (before === undefined) delete process.env.OBJECT_BUDGET_MB; else process.env.OBJECT_BUDGET_MB = before
      await owner`delete from upload_sessions where patient_id = ${pid}`
    }
  }, 60_000)

  it('with an object store, an upload needs database room for its chunks only, not for the file as well', async () => {
    const c = await ctx()
    const { startUpload } = await import('../../src/server/uploads/chunks')
    const size = 40 * 1048576
    const start = () => c.db.withOrg(ORG_NARMADA_ID, (tx) => startUpload(tx, {
      orgId: ORG_NARMADA_ID, patientId: pid, uploader: base.uploadedBy, fileName: 'cd.zip', totalSize: size, totalChunks: Math.ceil(size / (3.5 * 1048576)),
      sha256: 'a'.repeat(64), intakeRoute: 'bulk',
    } as Parameters<typeof startUpload>[1]))
    const [{ used }] = await owner`select pg_database_size(current_database())::bigint as used`
    const before = process.env.STORAGE_BUDGET_MB
    try {
      process.env.STORAGE_BUDGET_MB = String(Math.ceil((Number(used) + 1.5 * size) / 1048576)) // room for 1.5 x the file
      c.objects.setObjectStoreForTests(memStore)
      await expect(start()).resolves.toMatchObject({ id: expect.any(String) })
      c.objects.setObjectStoreForTests(null)
      await expect(start()).rejects.toMatchObject({ status: 507, code: 'storage_full' })
    } finally {
      if (before === undefined) delete process.env.STORAGE_BUDGET_MB; else process.env.STORAGE_BUDGET_MB = before
      await owner`delete from upload_sessions where patient_id = ${pid}`
    }
  }, 60_000)

  it('with no store configured, files stay in Postgres as before', async () => {
    const c0 = await ctx()
    c0.objects.setObjectStoreForTests(null)
    const { c, row } = await uploadStudy('1.2.826.0.1.3680043.8.498.903')
    expect(row.object_key).toBeNull()
    expect(row.n).toBeGreaterThan(0)
    const file = await c.db.withOrg(ORG_NARMADA_ID, (tx) => c.files.readFile(tx, row.id))
    expect(createHash('sha256').update(file!.bytes).digest('hex')).toBe(row.sha256)
  }, 90_000)
})
