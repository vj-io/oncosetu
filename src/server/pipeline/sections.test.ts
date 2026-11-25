import { describe, expect, it } from 'vitest'
import type { OcrWord } from '@/db/schema'
import { analyse, classify, headerFor, splitSections } from './core'
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
  it('a clear change of kind starts a report without a date; its date stays unknown', () => {
    const path = 'NIRNAY PATHOLOGY LABORATORY\nHISTOPATHOLOGY REPORT\nSpecimen: Left breast, wide local excision.\nGross: A fibrofatty tissue.\nMicroscopy: Invasive ductal carcinoma, grade 2.\nMargins: All margins free of tumour.\nDiagnosis: Invasive carcinoma of no special type.\nPathologist\n'
    expect(split([page(1, report('04/10/2025')), page(2, path)])).toEqual([[[1], '2025-10-04'], [[2], null]])
    // A page of another kind with no letterhead, title or date label of its own stays with the report.
    const bare = 'Surgical specimen\nSpecimen: Left breast, wide local excision.\nGross: A fibrofatty tissue.\nMicroscopy: Invasive ductal carcinoma, grade 2.\nMargins: All margins free of tumour.\nDiagnosis: Invasive carcinoma of no special type.\nImmunohistochemistry: ER positive.\nPathologist\n'
    expect(split([page(1, report('04/10/2025')), page(2, bare)])).toEqual([[[1, 2], '2025-10-04']])
    // A page under its own letterhead that reads only weakly as another kind (pathology 4) stays too.
    const weak = 'CITY DIAGNOSTIC CENTRE\nSpecimen: Left breast, wide local excision.\nGross: A fibrofatty tissue.\nMicroscopy: Invasive ductal carcinoma, grade 2.\nMargins: All margins free of tumour.\nDiagnosis: Invasive carcinoma of no special type.\nTumour size 2.1 cm, lymphovascular invasion absent.\n'
    expect(split([page(1, report('04/10/2025')), page(2, weak)])).toEqual([[[1, 2], '2025-10-04']])
    // With a date label of its own (legible only to the month), it is a report of its own, its day unknown.
    expect(split([page(1, report('04/10/2025')), page(2, `Report Date: 06/2022\n${bare}`)])).toEqual([[[1], '2025-10-04'], [[2], null]])
  })
  it('each report is named by all its readable pages, not its first page alone', () => {
    // The lab report's first page is only its letterhead and date: on its own it reads as nothing (the file is mostly imaging).
    const labHead = 'SHREE DIAGNOSTICS\nReport Date: 13/11/2026\nPatient copy\n'
    const labRows = 'Haemoglobin\t11.2\tg/dL\t12.0 - 15.0\nTotal Leucocyte Count\t6800\t/cumm\t4000 - 11000\nPlatelet Count\t2.1\tlakh/cumm\t1.5 - 4.5\nNeutrophils\t62\t%\t40 - 75\nLymphocytes\t30\t%\t20 - 45\nReference range\nComplete blood count\n'
    const pages = [page(1, report('04/10/2025')), page(2, report('05/10/2025', 'MRI brain')), page(3, labHead), page(4, labRows)]
    const c = classify(pages)
    expect(c.docType).toBe('imaging_report')
    expect(splitSections(pages, c, RECEIVED).map((x) => [x.pages, x.docType])).toEqual([[[1], 'imaging_report'], [[2], 'imaging_report'], [[3, 4], 'lab_report']])
  })
  it('the first readable page is read whole for its date, as the file date is; a file that starts held takes it too', () => {
    const late = `CITY IMAGING CENTRE\n${Array.from({ length: 20 }, (_, i) => `Line ${i + 1}.`).join('\n')}\nDate: 12/02/2025\n`
    expect(split([held(1), page(2, late), page(3, report('10/10/2026'))])).toEqual([[[1, 2], '2025-02-12'], [[3], '2026-10-10']])
  })
})

describe('every report keeps its own facts and dates (E-DOC-10)', () => {
  const file = [page(1, report('12/02/2025')), page(2, report('10/10/2026', 'MRI brain')), page(3, report('09/12/2025', 'USG abdomen'))]
  it('a later report with no date of its own does not borrow the file\'s date', async () => {
    const path = 'NIRNAY PATHOLOGY LABORATORY\nHISTOPATHOLOGY REPORT\nSpecimen: Left breast, wide local excision.\nMicroscopy: Invasive ductal carcinoma, grade 2.\nMargins: All margins free of tumour.\nDiagnosis: Invasive carcinoma of no special type.\n'
    const a = await analyse([page(1, report('04/10/2025')), page(2, path)], PATIENT, RECEIVED)
    const onPage2 = a.drafts.filter((d) => d.evidence.pageNo === 2)
    expect(onPage2.length).toBeGreaterThan(0)
    expect(onPage2.every((d) => d.documentDate === null)).toBe(true)
  })
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


// A photographed report whose table header prints a study date and a report date on every page (25 Nov 2026, pilot PET-CT
// file). Synthetic text in the shape its pages read: "|" for the table's rules, tabs between cells.
describe('photographed table headers', () => {
  const pet = (study: string, reportDate: string | null, body = 'WHOLE BODY PET-CT SCAN\nFindings: No abnormal FDG avid lesion.\nImpression: Complete metabolic response.\n') =>
    `CITY PET-CT IMAGING CENTRE\nPatient Name | Mrs. Asha Testkar\tAge | 47Yr\nPatient ID\tPET/2026/0412\tSex | Female\nStudy Date\t${study}\t${reportDate ? `Report Date | ${reportDate}` : 'Time | 6:20pm'}\n${body}`
  it('headerFor takes the report date from a table cell, over the study date', () => {
    expect(headerFor(pet('03 Mar 2026', '05 Mar 2026')).reportDate).toMatchObject({ value: '05 Mar 2026', label: 'report date' })
    expect(headerFor(pet('03 Mar 2026', null)).reportDate).toMatchObject({ value: '03 Mar 2026', label: 'visit date' })
    // a plain "Date" cell in the middle of a row (its label word lost to OCR)
    expect(headerFor('CITY PET-CT IMAGING CENTRE\nPatient Name | Asha Testkar\tDate | 05 Mar 2026\n').reportDate).toMatchObject({ value: '05 Mar 2026', label: 'date' })
  })
  it('a value read across a table rule is the page text exactly, its "|" kept', () => {
    const t = 'Name: Asha Testkar\nAge: 47\nSex: F\nUHID: 77\nDate: 03/03/2026\nRef: Dr A Rao\nCITY HOSPITAL AND RESEARCH CENTRE FOR CANCER CARE | RADIOLOGY\n'
    const h = headerFor(t)
    expect(h.institution?.value).toBe('CITY HOSPITAL AND RESEARCH CENTRE FOR CANCER CARE | RADIOLOGY')
    expect(t.slice(h.institution!.start, h.institution!.end)).toBe(h.institution!.value)
  })
  it('aligned colons after a label cell ("Patient Name <TAB> : X") still give the name', () => {
    const h = headerFor('CITY HOSPITAL\nPatient Name\t: Asha Testkar\tAge\t: 47 years\nGender\t:\tFemale\n')
    expect(h.name?.value).toBe('Asha Testkar')
    expect(h.sex?.sex).toBe('F')
  })
  it('a page whose header lost its report date but shares the study date stays in the same report', () => {
    expect(split([page(1, pet('03 Mar 2026', '05 Mar 2026')), page(2, pet('03 Mar 2026', null)), page(3, pet('03 Mar 2026', '05 Mar 2026'))]))
      .toEqual([[[1, 2, 3], '2026-03-05']])
    // The dates a report's pages share add up: page 3 shares only page 2's study date.
    expect(split([page(1, pet('—', '05 Mar 2026')), page(2, pet('03 Mar 2026', '05 Mar 2026')), page(3, pet('03 Mar 2026', null))]))
      .toEqual([[[1, 2, 3], '2026-03-05']])
    // A report that shares no date with it is a report of its own.
    expect(split([page(1, pet('03 Mar 2026', '05 Mar 2026')), page(2, pet('01 Feb 2026', '03 Feb 2026'))]))
      .toEqual([[[1], '2026-03-05'], [[2], '2026-02-03']])
  })
  // An OCR'd page: lines on a 15 px grid (or at the y given) over a 1000 px tall text extent, so each line's position is known
  // (line 17 at 24%).
  const ocrPage = (pageNo: number, lines: (string | [string, number])[]): PageRead => {
    let text = ''
    const words: OcrWord[] = []
    lines.forEach((entry, i) => {
      const [line, y] = typeof entry === 'string' ? [entry, i * 15] : entry
      if (text) text += '\n'
      for (const tok of line.split(/(\s+)/)) {
        if (!tok.trim()) { text += tok; continue }
        const s = text.length
        text += tok
        words.push({ t: tok, c: 0.9, s, e: text.length, b: [10, y, 10 + tok.length * 8, y + 12] })
      }
    })
    words.push({ t: '.', c: 0.9, s: text.length, e: text.length + 1, b: [10, 984, 18, 1000] })
    return page(pageNo, `${text}.`, { source: 'ocr', words })
  }
  const letterhead = ['CITY HOSPITAL', 'CITY CANCER CENTRE', 'A unit of the city trust', ...Array.from({ length: 13 }, (_, i) => `Road ${i + 1}, Phone 0000 000${i}`)]
  it('on an OCR\'d page, a header date below line 15 but in the top 30% of the page starts a report; one further down does not', () => {
    const first = page(1, pet('03 Mar 2026', '05 Mar 2026'))
    expect(split([first, ocrPage(2, [...letterhead, 'Date: 14/01/2026', 'CT SCAN OF CHEST', 'Findings: normal study.'])]))
      .toEqual([[[1], '2026-03-05'], [[2], '2026-01-14']])
    // the same line 17 at 60% of the page is body text
    const far = ocrPage(2, [...letterhead, ['Compared with scan Date: 14/01/2026', 600]])
    expect(split([first, far])).toEqual([[[1, 2], '2026-03-05']])
    // and a page of 40 small lines all in its top 30% takes no more than 25 of them
    const dense = ocrPage(2, [...letterhead, ...Array.from({ length: 10 }, (_, i): [string, number] => [`Finding ${i + 1}.`, 228 + 2 * i]), ['Compared with scan Date: 14/01/2026', 250]])
    expect(split([first, dense])).toEqual([[[1, 2], '2026-03-05']])
  })
})

describe('identity of a paper with no readable report date', () => {
  // PATIENT is 51 on the day RECEIVED; the paper below prints no date at all.
  const undated = (age: string) => page(1, `CITY IMAGING CENTRE\nPatient Name: Mrs. Asha Testkar\tAge: ${age}\tSex: Female\nCT scan of chest\nFINDINGS: No focal lesion in the lungs.\n`)
  it('a printed age she cannot have reached by its upload rules her out; her own age does not confirm her', async () => {
    expect((await analyse([undated('60 Yrs')], PATIENT, RECEIVED)).identified.identity).toMatchObject({ result: 'mismatch', reasons: ['age_mismatch'] })
    expect((await analyse([undated('51 Yrs')], PATIENT, RECEIVED)).identified.identity).toMatchObject({ result: 'insufficient', notes: ['age_not_compared_no_report_date'] })
  })
})

// A header table whose cells come out stacked, as a digital report's text layer read on 25 Nov 2026: each label cell's lines,
// then its value cell's lines. Synthetic values.
describe('a header table read as stacked labels, then their values', () => {
  const P2 = { name: 'Asha Testkar', aliases: [], dob: '1979-06-10', sex: 'female' } // 46 on 05 Mar 2026
  const paper = (o: { name?: string | null; age?: string | null; sex?: string | null; study?: string[]; report?: string[] } = {}) => [
    ...(o.name === null ? [] : [`Patient Name\t${o.name ?? 'Asha Testkar'}`]),
    ...(o.age === null ? [] : [`Patient ID\tAB1234\tAge\t${o.age ?? '46Yr'}`]),
    ...(o.sex === null ? [] : [`Referral Dr\tDr A Rao\tSex\t${o.sex ?? 'Female'}`]),
    'Study Date', 'Time', ...(o.study ?? ['03 Mar 2026', '4:05pm']),
    'Report Date', 'Time', ...(o.report ?? ['05 Mar 2026', '6:20pm']),
    'Page 1 of 3\tPowered by example lab', 'CT PULMONARY ANGIOGRAPHY',
    'Clinical Details: Known case. PET CT study of 26 June 2025 was available.',
    'FINDINGS: No filling defect in the pulmonary arteries.', 'IMPRESSION: No pulmonary embolism.',
  ].join('\n') + '\n'
  it('each value pairs with the label in its place: the report date is the report date, never the body\'s earlier study', () => {
    expect(headerFor(paper()).reportDate).toMatchObject({ value: '05 Mar 2026', label: 'report date' })
    expect(split([page(1, paper())])).toEqual([[[1], '2026-03-05']])
  })
  it('counts or shapes that disagree pair nothing', () => {
    // values in the wrong order (time where the date belongs)
    expect(headerFor(paper({ study: ['4:05pm', '03 Mar 2026'], report: ['6:20pm', '05 Mar 2026'] })).reportDate).toBeUndefined()
    // a value missing: the next line is not a time
    expect(headerFor(paper({ report: ['05 Mar 2026'] })).reportDate?.label).not.toBe('report date')
    // a date label holding no date, or a line of text that merely contains one
    expect(headerFor(paper({ study: ['Pending', '4:05pm'], report: ['Pending', '6:20pm'] })).reportDate).toBeUndefined()
    expect(headerFor(paper({ study: ['Pending', '4:05pm'], report: ['Repeat after 05 Mar 2026', '6:20pm'] })).reportDate).toBeUndefined()
    // the text ends before the last value
    expect(headerFor('Patient Name\tAsha Testkar\nReport Date\nTime\n05 Mar 2026').reportDate).toBeUndefined()
  })
  it('name, age on the report date and sex all match: a match. Near misses do not pass', async () => {
    const id = async (o: Parameters<typeof paper>[0]) => (await analyse([page(1, paper(o))], P2, RECEIVED)).identified.identity
    expect(await id({})).toMatchObject({ result: 'match', reasons: [] })
    expect(await id({ age: '47Yr' })).toMatchObject({ result: 'match' }) // the gate's year of slack, unchanged
    expect(await id({ age: '48Yr' })).toMatchObject({ result: 'mismatch', reasons: ['age_mismatch'] })
    expect(await id({ age: '44Yr' })).toMatchObject({ result: 'mismatch', reasons: ['age_mismatch'] })
    expect(await id({ sex: 'Male' })).toMatchObject({ result: 'mismatch', reasons: ['sex_mismatch'] })
    expect(await id({ name: 'Rekha Banerjee' })).toMatchObject({ result: 'mismatch', reasons: ['name_mismatch'] })
    // only the name: nothing confirms it, and the paper says so
    expect(await id({ age: null, sex: null })).toMatchObject({ result: 'insufficient', reasons: ['no_corroborating_field'] })
    // the dates unreadable: the age and the ID are read but cannot confirm her, and the reasons say exactly that
    expect(await id({ study: ['Pending', '4:05pm'], report: ['Pending', '6:20pm'] })).toMatchObject({ result: 'insufficient', reasons: ['name_not_confirmed', 'age_not_compared_no_report_date', 'mrn_not_registered'] })
  })
})
