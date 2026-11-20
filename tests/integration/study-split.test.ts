// A study larger than one stored document is cut into parts at upload instead of being refused (a real brain MRI CD held a
// 551 MB study, the cap is 300 MB). Here the cap is a few KB so synthetic slices show the same thing: every slice is kept, each
// part fits, the record shows one study, and the viewer steps through all slices in reading order across the parts.
// Uses synthetic files only. Needs .env.local.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { zipSync } from 'fflate'
import postgres from 'postgres'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'

const CAP = 4000
vi.mock('@/core/limits', async (orig) => ({ ...(await orig<typeof import('../../src/core/limits')>()), MAX_STUDY_BUNDLE_BYTES: CAP }))

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })

const pid = randomUUID()
const ctx = async () => ({
  db: (await import('../../src/db')), schema: await import('../../src/db/schema'),
  up: await import('../../src/server/pipeline/upload'), proc: await import('../../src/server/pipeline/process'),
  syn: await import('../../src/server/pipeline/dicom-synthetic'), crypto: await import('../../src/server/crypto'),
})
const uploader = { kind: 'staff' as const, id: randomUUID() }
const base = { orgId: ORG_NARMADA_ID, patientId: pid, uploadedBy: uploader, intakeRoute: 'bulk' as const }

beforeAll(async () => {
  const c = await ctx()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, sex) values (${pid}, ${ORG_NARMADA_ID}, ${'t-' + pid}, ${c.crypto.encryptField('Sunita Deshmukh')}, ${c.crypto.encryptField('1974-08-14')}, 'female')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG_NARMADA_ID}, ${pid}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_NARMADA_ID}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)` // originals are deletable only on the erasure path (0021)
    for (const t of ['evidence', 'events', 'missing_records', 'document_pages', 'document_files', 'documents']) await tx.unsafe(`delete from ${t} where patient_id = '${pid}'`)
    await tx`delete from audit_log where target_id = ${pid}`.catch(() => {})
    await tx.unsafe(`delete from consents where patient_id = '${pid}'`).catch(() => {})
  }).catch(() => {})
  await owner.end()
})

describe('a study larger than one stored document', () => {
  it('is kept as parts that each fit, shown as one study, and stepped through in reading order across the parts', async () => {
    const c = await ctx()
    const { MAX_STUDY_BUNDLE_BYTES } = await import('../../src/core/limits')
    expect(MAX_STUDY_BUNDLE_BYTES).toBe(CAP) // the mock reached the module upload.ts reads
    const uid = '1.2.826.0.1.3680043.8.498.901'
    const files: Record<string, Uint8Array> = {}
    // two series, given out of order in the ZIP: reading order is series as they first appear, then instance number
    for (const [i, s] of [[3, 'A'], [1, 'A'], [2, 'A'], [5, 'B'], [4, 'B'], [6, 'B'], [7, 'B'], [8, 'B']] as const) {
      files[`MR/${s}${i}`] = await c.syn.buildSyntheticDicom({ modality: 'MR', patientName: 'Deshmukh^Sunita', sex: 'F', age: '051Y', studyUid: uid, seriesUid: `${uid}.${s}`, instance: i, size: 16 })
    }
    const total = Object.values(files).reduce((n, f) => n + f.length, 0)
    expect(total).toBeGreaterThan(2 * CAP) // without the split this study would be refused as too large

    const r = await c.db.withOrg(ORG_NARMADA_ID, (tx) => c.up.ingestUpload(tx, { ...base, fileName: 'mri-cd.zip', bytes: zipSync(files) }))
    expect(r.rejected).toBeUndefined()
    expect(r.skipped.filter((s) => /study/.test(s.name))).toEqual([])
    for (const d of r.documents) if (d.status === 'queued') await c.proc.runDocument(d.documentId, ORG_NARMADA_ID)
    expect(r.documents.length).toBeGreaterThan(1)

    const { loadRecords, filedPaperCount } = await import('../../src/server/records/queries')
    const { studyParts, previewTarget } = await import('../../src/server/pipeline/study-parts')
    const { bundleSliceAt } = await import('../../src/server/pipeline/study')
    const { readDicomMeta } = await import('../../src/server/pipeline/dicom')
    const { readFile } = await import('../../src/server/files')
    const all = (await c.db.withOrg(ORG_NARMADA_ID, (tx) => loadRecords(tx, pid))).rows
    const rows = all.filter((x) => x.scan?.studyUid === uid)
    expect(rows).toHaveLength(1)
    expect(rows[0].scan).toMatchObject({ instances: 8, parts: r.documents.length })
    // the "All records" tab badge counts what the list shows: the parts once, not once each
    expect(await c.db.withOrg(ORG_NARMADA_ID, (tx) => filedPaperCount(tx, pid))).toBe(all.length)

    // every slice, through the preview route's own path (previewTarget -> part -> bundleSliceAt), in reading order
    const seen = await c.db.withOrg(ORG_NARMADA_ID, async (tx) => {
      const [first] = await tx.select().from(c.schema.documents).where(eq(c.schema.documents.id, rows[0].id))
      const parts = await studyParts(tx, first)
      expect(parts.reduce((n, p) => n + p.slices, 0)).toBe(8)
      const out: number[] = []
      for (let k = 0; k < 8; k++) {
        const at = previewTarget(first, parts, k)
        const [f] = await tx.select({ id: c.schema.documentFiles.id }).from(c.schema.documentFiles).where(and(eq(c.schema.documentFiles.documentId, at.id), eq(c.schema.documentFiles.kind, 'original')))
        const file = (await readFile(tx, f.id))!
        expect(file.bytes.length).toBeLessThanOrEqual(CAP) // each stored part fits
        out.push(readDicomMeta(bundleSliceAt(file.bytes, at.index).data!)!.instanceNumber!)
      }
      return out
    })
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  }, 90_000)
})
