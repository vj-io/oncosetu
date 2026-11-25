// E-DOC-10 against the real database: a file that holds several reports is listed in All records as one row per report,
// each with its own date, page images and facts (counted by the page their quote is on), and the newest report marked.
// The tab badge counts reports as the list shows them. Synthetic data on a demo org; needs .env.local.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_NARMADA_ID } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const ORG = ORG_NARMADA_ID
const pid = randomUUID()
let file = '', single = ''
const SECTIONS = [
  { pages: [1, 2], date: '2025-02-12', docType: 'imaging_report', institution: 'City Imaging Centre' },
  { pages: [3], date: '2026-10-10', docType: 'imaging_report', institution: 'Town Diagnostic Laboratory' },
  { pages: [4], date: null, docType: 'imaging_report', institution: null },
]

const imp = async () => ({
  db: await import('../../src/db'), crypto: await import('../../src/server/crypto'),
  q: await import('../../src/server/records/queries'), core: await import('../../src/server/records/core'),
})

beforeAll(async () => {
  const c = await imp()
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`insert into patients (id, org_id, oncosetu_token_hash, name_enc, dob_enc, sex, disclosure_status) values (${pid}, ${ORG}, ${'t-' + pid}, ${c.crypto.encryptField('Folder Upload Test')}, ${c.crypto.encryptField('1970-01-01')}, 'female', 'cleared')`
    await tx`insert into consents (org_id, patient_id, action, purposes, actor_type, notice_version, language) values (${ORG}, ${pid}, 'grant', ${tx.json({ store: true, ai: false, share: false, abdm: false, metrics: false })}, 'staff', 'v1', 'en')`
    const doc = async (pages: number, flags: Record<string, unknown>) => (await tx`insert into documents (org_id, patient_id, sha256, mime, size_bytes, intake_route, uploaded_by_kind, attach_state, status, doc_type, document_date, pages, flags)
      values (${ORG}, ${pid}, ${randomUUID()}, 'application/pdf', 1, 'desk_capture', 'staff', 'attached', 'done', 'imaging_report', '2025-02-12', ${pages}, ${tx.json(flags as never)}) returning id`)[0].id as string
    file = await doc(4, { sections: SECTIONS })
    single = await doc(1, {})
    for (let n = 1; n <= 4; n++) {
      await tx`insert into document_files (org_id, patient_id, document_id, kind, page_no, mime, bytes_enc, dek_wrapped, size, sha256)
        values (${ORG}, ${pid}, ${file}, 'page_image', ${n}, 'image/jpeg', ${Buffer.from('x')}, 'v1.dek', 1, 'h')`
    }
    // Report 2's body names the study of report 1 ("dated 12/02/2025"): a comparison, not report 2's date.
    for (const [pageNo, text] of [[1, 'CITY IMAGING CENTRE\nDate: 12/02/2025\nMRI BRAIN'], [3, 'TOWN DIAGNOSTIC LABORATORY\nDate: 10/10/2026\nMRI BRAIN\nSmaller than on the previous scan dated 12/02/2025.']] as const) {
      await tx`insert into document_pages (org_id, patient_id, document_id, page_no, text) values (${ORG}, ${pid}, ${file}, ${pageNo}, ${text})`
    }
    for (const [i, pageNo] of [1, 3, 3].entries()) {
      // The last one is report 2's quote of the 2025 study: an old date, flagged late_received like the pipeline does.
      const [ev] = await tx`insert into events (org_id, patient_id, document_id, event_type, source_type, extraction_method, flags)
        values (${ORG}, ${pid}, ${file}, 'imaging_report_documented', 'external_document', 'ocr_llm', ${tx.json(i === 2 ? { late_received: true } : {})}) returning id`
      await tx`insert into evidence (org_id, patient_id, event_id, document_id, page_no, quote) values (${ORG}, ${pid}, ${ev.id}, ${file}, ${pageNo}, 'a quote')`
    }
  })
})
afterAll(async () => {
  await owner.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`
    await tx`select set_config('oncosetu.erasing', 'on', true)`
    for (const t of ['evidence', 'events', 'document_pages', 'document_files', 'documents', 'consents']) await tx.unsafe(`delete from ${t} where patient_id = '${pid}'`)
    await tx`delete from patients where id = ${pid}`
  }).catch(() => {})
  await owner.end()
  await (await import('../../src/db')).closeDb()
})

describe('a file of several reports in All records (E-DOC-10)', () => {
  it('one row per report: its own date, pages and facts; the newest marked; the badge counts reports', async () => {
    const c = await imp()
    const { rows, count } = await c.db.withOrg(ORG, async (tx) => ({ rows: (await c.q.loadRecords(tx, pid)).rows, count: await c.q.filedPaperCount(tx, pid) }))
    const mine = rows.filter((r) => r.docId === file).sort((a, b) => a.section!.n - b.section!.n)
    expect(mine.map((r) => [r.id, r.date, r.dateFrom, r.pageImages, r.facts, r.section!.newest, r.institution])).toEqual([
      [`${file}.1`, '2025-02-12', 'paper', [1, 2], 1, false, 'City Imaging Centre'],
      [`${file}.2`, '2026-10-10', 'paper', [3], 2, true, 'Town Diagnostic Laboratory'], // its own hospital, not the file's
      [`${file}.3`, expect.any(String), 'received', [4], 0, false, null], // no date of its own: shown by the day received
    ])
    expect(mine.every((r) => r.title === 'Imaging report' && r.section!.of === 3)).toBe(true)
    // Linked to report 1 of the same file, not to the other paper of that day.
    expect(mine[1].compared).toEqual([{ date: '2025-02-12', month: false, rowIds: [`${file}.1`] }])
    expect(mine[0].comparedBy).toEqual([`${file}.2`])
    // Older record by the report's own date: report 1 (Feb 2025) is, report 2 (Oct 2026) is not, though it quotes the 2025 study.
    expect(mine.map((r) => r.lateReceived)).toEqual([true, false, false])
    expect(rows.find((r) => r.id === single)).toMatchObject({ docId: single })
    expect(rows.find((r) => r.id === single)!.section).toBeUndefined()
    expect(count).toBe(4) // 3 reports + 1 single paper, as the list shows them
    expect(c.core.filesOf(c.core.sortRecords(rows)).map((r) => r.id).sort()).toEqual([file, single].sort()) // the document page walks files
  })
})
