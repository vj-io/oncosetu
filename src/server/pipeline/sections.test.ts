import { describe, expect, it } from 'vitest'
import { analyse, classify, splitSections } from './core'
import { olderRecord } from './queries'
import type { PageRead } from './text'

// E-DOC-10: one file holding several reports (a patient's folder photographed in one go) is split by the reports' own
// headers; each report gets its own report-level fact, and every fact takes the date of the report it was quoted from.
// Synthetic text only.
const RECEIVED = new Date('2026-11-20T06:00:00Z')
const PATIENT = { name: 'Asha Testkar', aliases: [], dob: '1975-01-01', sex: 'female' }
const page = (pageNo: number, text: string, extra: Partial<PageRead> = {}): PageRead => ({
  pageNo, text, words: null, ocrConfidence: null, lowConfidence: false, source: 'text_layer', handwriting: null, hidden: null, image: null,
  processor: 'test', processorVersion: '1', ...extra,
})
const report = (date: string, scan = 'CT scan of chest') =>
  `CITY IMAGING CENTRE\nDepartment of Radiology\nPatient Name: Mrs. Asha Testkar\tAge/Sex: 51 Y / F\nDate: ${date}\tRef By: Dr. A Rao\n${scan}\nFINDINGS: No focal lesion in the lungs.\nIMPRESSION: No evidence of metastasis.\n`
/** A report's second page: no header, and a date far down the body (an earlier scan) that must not start a report. */
const continuation = `${Array.from({ length: 16 }, (_, i) => `Observation line ${i + 1} within normal limits.`).join('\n')}\nCompared with previous scan Date: 01/01/2020.\n`
const held = (pageNo: number) => page(pageNo, '', { source: 'ocr', handwriting: { handwritten: true, lowLineShare: 0.5, lines: 12, blueInkShare: 0 } })
const split = (pages: PageRead[]) => splitSections(pages, classify(pages), RECEIVED).map((s) => [s.pages, s.date?.iso ?? null])

describe('a file of several reports is split by their headers (E-DOC-10)', () => {
  it('a new header date starts a report; a continuation page, a body date and a held page stay with their report', () => {
    expect(split([page(1, report('12/02/2025')), page(2, continuation), held(3), page(4, report('10/10/2026')), page(5, report('09/12/2025'))]))
      .toEqual([[[1, 2, 3], '2025-02-12'], [[4], '2026-10-10'], [[5], '2025-12-09']])
  })
  it('one report whose pages repeat the header with the same date stays one report', () => {
    expect(split([page(1, report('12/02/2025')), page(2, report('12/02/2025'))])).toEqual([[[1, 2], '2025-02-12']])
  })
  it('a letterhead without a date does not start a report', () => {
    expect(split([page(1, report('12/02/2025')), page(2, 'CITY IMAGING CENTRE\nDepartment of Radiology\nAddendum to the report above.\n')])).toEqual([[[1, 2], '2025-02-12']])
  })
  it('an undated report takes the date of its next page when that page has no letterhead', () => {
    expect(split([page(1, 'CITY IMAGING CENTRE\nCT scan of chest\nFINDINGS: No focal lesion.\n'), page(2, 'Date: 10/10/2026\nIMPRESSION: No evidence of metastasis.\n')]))
      .toEqual([[[1, 2], '2026-10-10']])
  })
  it('a same-day report of another class under its own letterhead is a report of its own', () => {
    const cbc = 'CITY PATHOLOGY LABORATORY\nPatient Name: Mrs. Asha Testkar\tAge/Sex: 51 Y / F\nDate: 12/02/2025\nCOMPLETE BLOOD COUNT\nHaemoglobin\t11.2\tg/dL\t12.0 - 15.0\nTotal Leucocyte Count\t6800\t/cumm\t4000 - 11000\nPlatelet Count\t2.1\tlakh/cumm\t1.5 - 4.5\nNeutrophils\t62\t%\t40 - 75\nLymphocytes\t30\t%\t20 - 45\nReference range\n'
    expect(split([page(1, report('12/02/2025')), page(2, cbc)])).toEqual([[[1], '2025-02-12'], [[2], '2025-02-12']])
  })
  it('a page that also scores for the report\'s own class stays with it', () => {
    const mixed = 'CITY PATHOLOGY LABORATORY\nDate: 12/02/2025\nCOMPLETE BLOOD COUNT\nHaemoglobin\t11.2\tg/dL\t12.0 - 15.0\nTotal Leucocyte Count\t6800\t/cumm\t4000 - 11000\nPlatelet Count\t2.1\tlakh/cumm\t1.5 - 4.5\nNeutrophils\t62\t%\t40 - 75\nLymphocytes\t30\t%\t20 - 45\nReference range\nCT scan of chest: FINDINGS: No focal lesion in the lungs. IMPRESSION: No evidence of metastasis. Radiology contrast study.\n'
    expect(split([page(1, report('12/02/2025')), page(2, mixed)])).toEqual([[[1, 2], '2025-02-12']])
  })
  it('the first readable page is read whole for its date, as the file date is; a file that starts held takes it too', () => {
    const late = `CITY IMAGING CENTRE\n${Array.from({ length: 20 }, (_, i) => `Line ${i + 1}.`).join('\n')}\nDate: 12/02/2025\n`
    expect(split([held(1), page(2, late), page(3, report('10/10/2026'))])).toEqual([[[1, 2], '2025-02-12'], [[3], '2026-10-10']])
  })
})

describe('every report keeps its own facts and dates (E-DOC-10)', () => {
  const file = [page(1, report('12/02/2025')), page(2, report('10/10/2026', 'MRI brain')), page(3, report('09/12/2025', 'USG abdomen'))]
  it('one report-level fact per report, each dated by its own report', async () => {
    const a = await analyse(file, PATIENT, RECEIVED)
    const reports = a.drafts.filter((d) => d.eventType === 'imaging_report_documented').map((d) => [d.evidence.pageNo, d.eventDate, d.documentDate])
    expect(reports).toEqual([[1, '2025-02-12', '2025-02-12'], [2, '2026-10-10', '2026-10-10'], [3, '2025-12-09', '2025-12-09']])
  })
  it('a scan dated after its own report is a plan, judged by that report\'s date even when the file has none', async () => {
    const undated = page(1, 'CITY IMAGING CENTRE\nCT scan of chest\nFINDINGS: No focal lesion in the lungs.\n')
    const a = await analyse([undated, page(2, `${report('10/10/2026')}PET-CT on 30/10/2026 after cycle 4.\n`)], PATIENT, RECEIVED)
    expect(a.identified.documentDate).toBeNull() // the file itself has no date
    const dates = a.drafts.filter((d) => d.eventType === 'imaging_report_documented').map((d) => d.eventDate)
    expect(dates).toContain('2026-10-10')
    expect(dates).not.toContain('2026-10-30')
  })
})

describe('"older record, newly received" goes by the paper\'s own date (E-DOC-15)', () => {
  const received = new Date('2026-11-25T06:00:00Z')
  it('a recent report that quotes an older study is not an older record', () => {
    expect(olderRecord({ documentDate: '2026-10-10', receivedAt: received, flags: {} }, true)).toBe(false)
    expect(olderRecord({ documentDate: '2025-02-12', receivedAt: received, flags: {} }, false)).toBe(true)
  })
  it('a file of several reports is older when any of its reports is; a paper with no date keeps its facts\' flag', () => {
    const sections = [{ date: '2026-10-10' }, { date: '2025-02-12' }]
    expect(olderRecord({ documentDate: '2026-10-10', receivedAt: received, flags: { sections } }, false)).toBe(true)
    expect(olderRecord({ documentDate: '2026-10-10', receivedAt: received, flags: { sections: [{ date: '2026-10-10' }, { date: null }] } }, true)).toBe(false)
    expect(olderRecord({ documentDate: null, receivedAt: received, flags: {} }, true)).toBe(true)
    expect(olderRecord({ documentDate: null, receivedAt: received, flags: {} }, false)).toBe(false)
  })
})

