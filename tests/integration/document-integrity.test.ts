// FR-DOC-08 at the DATABASE level (0021): an original file never changes and is deleted only on the erasure path;
// derived page text and page images are versioned (superseded, never deleted or rewritten, by reprocessing).
// Also, through the real pipeline: a pluggable malware scanner (FR-ING-08), a script the OCR cannot read (FR-DOC-05)
// and a near-duplicate flag raised for a document forwarded twice (FR-ING-06).
//   npm run test:integration   (needs a database: DATABASE_URL_APP + DATABASE_URL_UNPOOLED)
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres, { type TransactionSql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_GANGA_ID, ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const app = postgres(process.env.DATABASE_URL_APP!, { max: 1, prepare: false, onnotice: () => {} })
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const ORG = ORG_NARMADA_ID
const pid = randomUUID()
const imp = async () => ({
  db: await import('../../src/db'), s: await import('../../src/db/schema'), up: await import('../../src/server/pipeline/upload'),
  ingest: await import('../../src/server/pipeline/ingest'), proc: await import('../../src/server/pipeline/process'),
  q: await import('../../src/server/pipeline/queries'), crypto: await import('../../src/server/crypto'),
})

class Rollback extends Error {}
/** Seeds a document with an original, a page image and a page as `sql`'s role in one transaction, runs `fn`, rolls back; returns the error code or 'ok'. */
async function attempt(sql: postgres.Sql, fn: (tx: TransactionSql, ids: { original: string; image: string; page: string; doc: string; patient: string }) => Promise<unknown>): Promise<string> {
  let code = 'ok'
  await sql.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG_GANGA_ID}, true)`
    const patient = randomUUID()
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc) values (${patient}, ${ORG_GANGA_ID}, ${'t-' + patient}, 'v1.x')`
    const [doc] = await tx`insert into documents (org_id, patient_id, sha256, mime, size_bytes, intake_route, uploaded_by_kind) values (${ORG_GANGA_ID}, ${patient}, 'h', 'image/jpeg', 1, 'desk', 'staff') returning id`
    const file = (kind: string, pageNo: number | null) => tx`insert into document_files (org_id, patient_id, document_id, kind, page_no, mime, bytes_enc, dek_wrapped, size, sha256)
      values (${ORG_GANGA_ID}, ${patient}, ${doc.id}, ${kind}, ${pageNo}, 'image/jpeg', ${Buffer.from('x')}, 'v1.dek', 1, 'h') returning id`
    const [[original], [image], [page]] = await Promise.all([file('original', null), file('page_image', 1),
      tx`insert into document_pages (org_id, patient_id, document_id, page_no, text) values (${ORG_GANGA_ID}, ${patient}, ${doc.id}, 1, 'page text') returning id`])
    try { await fn(tx, { original: original.id, image: image.id, page: page.id, doc: doc.id, patient }) } catch (e) { code = (e as { code?: string }).code ?? 'error' }
    throw new Rollback()
  }).catch((e) => { if (!(e instanceof Rollback)) throw e })
  return code
}

beforeAll(async () => {
  const c = await imp()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, sex, disclosure_status) values (${pid}, ${ORG}, ${'t-' + pid}, ${c.crypto.encryptField('Sunita Deshmukh')}, ${c.crypto.encryptField('1974-08-14')}, 'female', 'cleared')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${pid}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)`
    for (const t of ['evidence', 'events', 'missing_records', 'ai_runs', 'document_pages', 'document_files', 'documents', 'consents']) await tx.unsafe(`delete from ${t} where patient_id = '${pid}'`)
  }).catch(() => {})
  await app.end()
  await owner.end()
  await (await import('../../src/db')).closeDb()
})

describe('FR-DOC-08: originals are immutable (database triggers, every role)', () => {
  it('the app role cannot change an original or delete it, even with the erasure flag set', async () => {
    expect(await attempt(app, (tx, i) => tx`update document_files set bytes_enc = ${Buffer.from('y')} where id = ${i.original}`)).toBe('42501')
    expect(await attempt(app, (tx, i) => tx`update document_files set sha256 = 'other' where id = ${i.original}`)).toBe('42501')
    expect(await attempt(app, (tx, i) => tx`update document_files set kind = 'page_image' where id = ${i.original}`)).toBe('42501')
    expect(await attempt(app, (tx, i) => tx`update document_files set superseded_at = now() where id = ${i.original}`)).toBe('42501')
    expect(await attempt(app, (tx, i) => tx`delete from document_files where id = ${i.original}`)).toBe('42501')
    expect(await attempt(app, async (tx, i) => {
      await tx`select set_config('oncosetu.erasing', 'on', true)`
      await tx`delete from document_files where id = ${i.original}`
    })).toBe('42501') // the flag alone opens nothing: only erase_patient() / abdm_erase() run as the owner
  }, 60_000)

  it('the owner cannot either, unless it is on the erasure path', async () => {
    expect(await attempt(owner, (tx, i) => tx`update document_files set bytes_enc = ${Buffer.from('y')} where id = ${i.original}`)).toBe('42501')
    expect(await attempt(owner, (tx, i) => tx`delete from document_files where id = ${i.original}`)).toBe('42501')
    expect(await attempt(owner, async (tx, i) => {
      await tx`select set_config('oncosetu.erasing', 'on', true)`
      await tx`delete from document_files where id = ${i.original}`
    })).toBe('ok')
  }, 60_000)

  it('derived rows are versioned: marked superseded once, never rewritten; a merge may move them', async () => {
    expect(await attempt(app, (tx, i) => tx`update document_files set superseded_at = now() where id = ${i.image}`)).toBe('ok')
    expect(await attempt(app, (tx, i) => tx`update document_pages set superseded_at = now() where id = ${i.page}`)).toBe('ok')
    expect(await attempt(app, (tx, i) => tx`update document_files set bytes_enc = ${Buffer.from('y')} where id = ${i.image}`)).toBe('42501')
    expect(await attempt(app, (tx, i) => tx`update document_pages set text = 'changed' where id = ${i.page}`)).toBe('42501')
    expect(await attempt(owner, (tx, i) => tx`update document_pages set text = 'changed' where id = ${i.page}`)).toBe('42501')
    expect(await attempt(owner, async (tx, i) => {
      await tx`update document_pages set superseded_at = now() where id = ${i.page}`
      await tx`update document_pages set superseded_at = now() + interval '1 day' where id = ${i.page}`
    })).toBe('42501') // a superseded version stays exactly as it was
    expect(await attempt(app, async (tx, i) => {
      const other = randomUUID()
      await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc) values (${other}, ${ORG_GANGA_ID}, ${'t-' + other}, 'v1.x')`
      for (const t of ['document_files', 'document_pages']) await tx.unsafe(`update ${t} set patient_id = '${other}' where document_id = '${i.doc}'`)
    })).toBe('ok')
    expect(await attempt(app, (tx, i) => tx`delete from document_files where id = ${i.image}`)).toBe('ok') // E-CON-02 discards a run's outputs
  }, 60_000)
})

async function upload(name: string, bytes: Uint8Array, over: Record<string, unknown> = {}) {
  const c = await imp()
  return c.db.withOrg(ORG, (tx) => c.ingest.ingestDocument(tx, { orgId: ORG, patientId: pid, uploadedBy: { kind: 'staff', id: randomUUID() }, intakeRoute: 'bulk', fileName: name, bytes, ...over }))
}
const docRow = async (id: string) => {
  const c = await imp()
  return c.db.withOrg(ORG, async (tx) => (await tx.select().from(c.s.documents).where(eq(c.s.documents.id, id)))[0])
}

describe('reprocessing keeps every earlier reading (FR-DOC-08)', () => {
  it('page text and page images are superseded, with processor name and version; readers see the current version only', async () => {
    const c = await imp()
    const up = await upload('ct.jpg', new Uint8Array(readFileSync('public/demo-docs/hero__03-ct-thorax-abdomen.jpg')))
    await c.proc.runDocument(up.documentId, ORG)
    await c.db.withOrg(ORG, (tx) => tx.update(c.s.documents).set({ status: 'queued', attempts: 0 }).where(eq(c.s.documents.id, up.documentId)))
    await c.proc.runDocument(up.documentId, ORG)

    const files = await owner`select kind, superseded_at, processor, processor_version, sha256 from document_files where document_id = ${up.documentId} order by created_at`
    const original = files.filter((f) => f.kind === 'original')
    expect(original).toHaveLength(1)
    expect(original[0].superseded_at).toBeNull()
    const images = files.filter((f) => f.kind === 'page_image')
    expect(images).toHaveLength(2)
    expect(images.map((f) => f.superseded_at === null)).toEqual([false, true]) // the first reading is kept, superseded
    for (const f of images) expect(f).toMatchObject({ processor: 'sharp', processor_version: expect.stringContaining('jpeg q85') })
    const pages = await owner`select page_no, superseded_at, processor from document_pages where document_id = ${up.documentId} order by created_at`
    expect(pages.map((p) => p.superseded_at === null)).toEqual([false, true])
    expect(pages.every((p) => p.processor === 'tesseract.js')).toBe(true)

    const detail = await c.db.withOrg(ORG, (tx) => c.q.documentDetail(tx, pid, up.documentId))
    expect(detail!.pages).toHaveLength(1)
    expect(detail!.pageImages).toEqual([1])
  }, 180_000)
})

describe('intake and pipeline paths', () => {
  it('a plugged-in MalwareScanner quarantines what it flags, with its own reason, name and label (FR-ING-08)', async () => {
    const scanner = { name: 'test-av', label: 'test scanner: every file is infected', scan: async () => ({ infected: true, reason: 'test_signature' }) }
    const r = await upload('report.pdf', new Uint8Array(readFileSync('public/demo-docs/hero__09-mammography-2024.pdf')), { scanner })
    expect(r.status).toBe('quarantined')
    expect((await docRow(r.documentId)).flags.quarantine).toEqual({ reasons: ['test_signature'], scan: 'test scanner: every file is infected', scanner: 'test-av' })
  }, 60_000)

  it('a report in a script the OCR does not support is kept, flagged language_unsupported and gives no facts (FR-DOC-05)', async () => {
    const c = await imp()
    const tamil = 'இரத்த பரிசோதனை அறிக்கை\nநோயாளியின் பெயர்: சுனிதா தேஷ்முக்\nவயது / பாலினம்: 51 / பெண்\nதேதி: 04/06/2026\nஹீமோகுளோபின் 10.8 g/dL\n'
    const up = await upload('report.txt', new Uint8Array(Buffer.from(tamil, 'utf8')))
    await c.db.withOrg(ORG, (tx) => tx.update(c.s.documents).set({ attachState: 'attached' }).where(eq(c.s.documents.id, up.documentId)))
    await c.proc.runDocument(up.documentId, ORG)
    const d = await docRow(up.documentId)
    expect(d).toMatchObject({ status: 'needs_review', flags: expect.objectContaining({ language_unsupported: true }) })
    expect((await owner`select count(*)::int as n from events where document_id = ${up.documentId}`)[0].n).toBe(0)
  }, 60_000)

  it('every proposal the gate discards is stored per item as rejected_unsupported, with no model text (FR-EXT-02)', async () => {
    const c = await imp()
    const { MockLanguageModelV4 } = await import('ai/test')
    const { setLlmProviderForTests } = await import('../../src/server/ai/provider')
    const reply = {
      schema_version: 'extraction.v1', doc_type: 'chemo_daycare_record',
      header: { name: null, age: null, sex: null, dob: null, mrn: null, report_date: null, institution: null, referring_doctor: null },
      items: [
        { event_type: 'chemotherapy_session_documented', fields: { cycle_number: 9 }, quote: 'Cycle 9 given on 01/01/2026 with full dose', page_no: 1 },
        { event_type: 'procedure_documented', fields: { stage: 'IV', procedure_text: 'x' }, quote: 'KASTURI DAY-CARE CHEMOTHERAPY UNIT', page_no: 1 },
        { event_type: 'lab_report_documented', fields: {}, quote: 'Cycle', page_no: 1 },
      ],
    }
    const model = new MockLanguageModelV4({
      provider: 'mock', modelId: 'mock-model',
      doGenerate: async () => ({ content: [{ type: 'text', text: JSON.stringify(reply) }], finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } }, warnings: [] }),
    })
    const [settings] = await owner`select flags from org_settings where org_id = ${ORG}`
    await owner`update org_settings set flags = flags || '{"ai_extraction": true}'::jsonb where org_id = ${ORG}`
    await owner.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${ORG}, true)`
      await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${pid}, 'grant', ${tx.json({ store: true, ai: true, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
    })
    setLlmProviderForTests({ provider: 'anthropic', modelId: 'mock-model', model } as never)
    try {
      const up = await upload('chemo.pdf', new Uint8Array(readFileSync('public/demo-docs/hero__02-chemo-daycare-cycle4.pdf')))
      await c.proc.runDocument(up.documentId, ORG)
      const gate = (await docRow(up.documentId)).flags.gate as { rejected: number; rejections: Record<string, unknown>[] }
      expect(gate.rejected).toBe(3)
      expect(gate.rejections).toEqual([
        { label: 'rejected_unsupported', reason: 'quote_not_found', field: null, banned: null, eventType: 'chemotherapy_session_documented', origin: 'llm', pageNo: 1 },
        { label: 'rejected_unsupported', reason: 'forbidden_field', field: 'stage', banned: null, eventType: 'procedure_documented', origin: 'llm', pageNo: 1 },
        { label: 'rejected_unsupported', reason: 'quote_too_short', field: null, banned: null, eventType: 'lab_report_documented', origin: 'llm', pageNo: 1 },
      ])
      expect(JSON.stringify(gate)).not.toMatch(/Cycle 9|KASTURI/)
    } finally {
      setLlmProviderForTests(undefined)
      await owner`update org_settings set flags = ${owner.json(settings.flags)} where org_id = ${ORG}`
    }
  }, 120_000)

  it('the same report forwarded twice (re-saved, so new bytes) is flagged as a near-duplicate of the first (FR-ING-06)', async () => {
    const c = await imp()
    const { PDFDocument } = await import('pdf-lib')
    const first = new Uint8Array(readFileSync('public/demo-docs/hero__10-histopathology-later.pdf'))
    const doc = await PDFDocument.load(first)
    doc.setProducer('WhatsApp forward')
    doc.setModificationDate(new Date('2026-07-02T10:00:00Z'))
    const forwarded = await doc.save()
    const a = await upload('histo.pdf', first)
    await c.proc.runDocument(a.documentId, ORG)
    const b = await upload('histo (1).pdf', forwarded)
    expect(b.duplicateOf).toBeUndefined() // not byte-identical
    await c.proc.runDocument(b.documentId, ORG)
    const d = await docRow(b.documentId)
    expect(d.nearDupOf).toBe(a.documentId)
    expect(d.flags.near_duplicate).toMatchObject({ of: a.documentId, method: 'text', similarity: 1 })
    const docs = await c.db.withOrg(ORG, (tx) => tx.select({ id: c.s.documents.id }).from(c.s.documents).where(and(eq(c.s.documents.patientId, pid), eq(c.s.documents.nearDupOf, a.documentId))))
    expect(docs.map((x) => x.id)).toEqual([b.documentId])
  }, 120_000)
})
