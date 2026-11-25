import { describe, expect, it } from 'vitest'
import {
  applyLinkDecision, comparedDates, fmtCompared, linkComparisons,
  betterHeadline, bodyKey, collapseStudyParts, bodyLabel, countsByKind, otherAreaStudies, earlierStudies, filterRecords, fmtDay, kindOf, modalityKey, neighbours, proposePairs, reportTerms, resolvePairs,
  sortRecords, toRecordRow, type DocLike, type RecordRow, type ReportCandidate, type ScanCandidate,
} from './core'

const label = (t: string) => ({ imaging_report: 'Imaging report', lab_report: 'Lab report', pathology_report: 'Histopathology report', prescription_printed: 'Prescription' }[t] ?? t)
const doc = (o: Partial<DocLike> & { id: string }): DocLike => ({
  docType: null, mime: 'application/pdf', flags: {}, documentDate: null, institutionName: null, receivedAt: '2026-06-01T10:00:00.000Z', pages: 1, amendmentOf: null, handwritten: false, lowConfidence: false, ...o,
})
const row = (o: Partial<DocLike> & { id: string }, extra: Partial<{ facts: number; checked: number }> = {}) =>
  toRecordRow(doc(o), { docLabel: label, facts: extra.facts ?? 0, checked: extra.checked ?? 0, pageImages: [], asWritten: null, lateReceived: false })
const imaging = (modalities: string[], studyDate: string, bodyPart: string, institution = 'City Care Hospital') => ({ imaging: { modality: modalities[0], modalities, studyLabel: modalities.includes('PT') ? 'PET-CT' : 'CT scan', studyDate, bodyPart, institution, instances: 12, frames: 12 } })

describe('kinds', () => {
  it('sorts papers into reports, scans, labs, prescriptions and other', () => {
    expect(kindOf(doc({ id: 'a', docType: 'pathology_report' }))).toBe('report')
    expect(kindOf(doc({ id: 'a', docType: 'imaging_report' }))).toBe('report')
    expect(kindOf(doc({ id: 'a', docType: 'lab_report' }))).toBe('lab')
    expect(kindOf(doc({ id: 'a', docType: 'prescription_handwritten' }))).toBe('rx')
    expect(kindOf(doc({ id: 'a', docType: 'bill_insurance' }))).toBe('other')
    expect(kindOf(doc({ id: 'a', flags: imaging(['CT'], '2026-02-10', 'CHEST') }))).toBe('scan')
    expect(kindOf(doc({ id: 'a', flags: { imaging: { modality: 'ECG' }, file: { storedOnly: true } } }))).toBe('other')
    expect(kindOf(doc({ id: 'a', docType: 'other', flags: { consentForm: { action: 'grant' } } }))).toBe('other')
  })
  it('names a study by the words in its header', () => {
    expect(modalityKey(['PT', 'CT'])).toBe('PET-CT')
    expect(modalityKey(['MR'])).toBe('MR')
    expect(modalityKey(['DX'])).toBe('XR')
    expect(row({ id: 'p', flags: imaging(['PT', 'CT'], '2026-04-28', 'WHOLEBODY'), documentDate: null }).title).toBe('PET-CT whole body')
    expect(row({ id: 'c', flags: imaging(['CT'], '2026-02-10', 'CHEST') }).title).toBe('CT chest')
    expect(bodyLabel('WHOLEBODY')).toBe('Whole body')
    expect(bodyKey('CHEST')).toBe('chest')
  })
})

describe('date order', () => {
  const rows = [
    row({ id: 'a', docType: 'lab_report', documentDate: '2026-05-20' }),
    row({ id: 'b', docType: 'pathology_report', documentDate: '2026-01-30', receivedAt: '2026-06-04T10:00:00.000Z' }),
    row({ id: 'c', docType: 'imaging_report', documentDate: null, receivedAt: '2026-03-02T10:00:00.000Z' }),
    row({ id: 'd', flags: imaging(['CT'], '2026-02-10', 'CHEST'), documentDate: '2026-02-12' }),
  ]
  it('puts the paper date first and the scan study date ahead of its filing date', () => {
    expect(sortRecords(rows).map((r) => r.id)).toEqual(['a', 'c', 'd', 'b'])
    expect(sortRecords(rows, 'old').map((r) => r.id)).toEqual(['b', 'd', 'c', 'a'])
    expect(rows.find((r) => r.id === 'd')!.date).toBe('2026-02-10')
  })
  it('falls back to the day received and says so', () => {
    const c = rows.find((r) => r.id === 'c')!
    expect(c.dateFrom).toBe('received')
    expect(c.date).toBe('2026-03-02')
    expect(rows.find((r) => r.id === 'a')!.dateFrom).toBe('paper')
  })
  it('is stable when dates tie', () => {
    const x = [row({ id: 'z', documentDate: '2026-01-01' }), row({ id: 'y', documentDate: '2026-01-01' })]
    expect(sortRecords(x).map((r) => r.id)).toEqual(sortRecords([...x].reverse()).map((r) => r.id))
  })
  it('prints day then month', () => {
    expect(fmtDay('2026-04-28')).toBe('28 Apr 2026')
    expect(fmtDay('2026-03-05')).toBe('5 Mar 2026')
    expect(fmtDay(null)).toBe('date not stated')
  })
})

describe('filters', () => {
  const rows: RecordRow[] = [
    row({ id: 'r1', docType: 'imaging_report', documentDate: '2026-04-28', institutionName: 'City Care Hospital' }),
    row({ id: 's1', flags: imaging(['PT', 'CT'], '2026-04-28', 'WHOLEBODY') }),
    row({ id: 's2', flags: imaging(['CT'], '2026-02-10', 'CHEST') }),
    row({ id: 'l1', docType: 'lab_report', documentDate: '2026-05-20' }),
    row({ id: 'x1', docType: 'prescription_printed', documentDate: '2026-05-12' }),
    row({ id: 'o1', docType: 'bill_insurance', documentDate: '2026-05-13' }),
  ]
  it('counts and filters by kind', () => {
    expect(countsByKind(rows)).toEqual({ all: 6, report: 1, scan: 2, lab: 1, rx: 1, other: 1 })
    expect(filterRecords(rows, { kind: 'scan' }).map((r) => r.id)).toEqual(['s1', 's2'])
    expect(filterRecords(rows, { kind: 'all' })).toHaveLength(6)
  })
  it('filters scans by modality', () => {
    expect(filterRecords(rows, { kind: 'scan', modality: 'CT' }).map((r) => r.id)).toEqual(['s2'])
    expect(filterRecords(rows, { modality: 'PET-CT' }).map((r) => r.id)).toEqual(['s1'])
    expect(filterRecords(rows, { modality: 'any' })).toHaveLength(6)
  })
  it('searches the title and hospital', () => {
    expect(filterRecords(rows, { q: 'city care' }).map((r) => r.id).sort()).toEqual(['r1', 's1', 's2'])
    expect(filterRecords(rows, { q: 'lab report' }).map((r) => r.id)).toEqual(['l1'])
  })
  it('walks the filtered list in order', () => {
    const list = sortRecords(filterRecords(rows, { kind: 'scan' }))
    expect(neighbours(list, 's1')).toMatchObject({ prev: null, next: { id: 's2' }, index: 0 })
    expect(neighbours(list, 's2')).toMatchObject({ prev: { id: 's1' }, next: null })
  })
})

describe('scan and report pairing', () => {
  const petReport = 'PET-CT WHOLE BODY REPORT\nCity Care Hospital\nImpression: as written by the radiologist.'
  const ctReport = 'CT CHEST REPORT\nUpvan Imaging\nCT thorax with contrast.'
  const scan = (id: string, o: Partial<ScanCandidate>): ScanCandidate => ({ id, date: '2026-04-28', institution: 'City Care Hospital', modality: 'PET-CT', bodyKey: 'whole', ...o })
  const rep = (id: string, text: string, o: Partial<ReportCandidate> = {}): ReportCandidate => ({ id, date: '2026-04-28', institution: 'City Care Hospital', terms: reportTerms(text), ...o })

  it('reads the study kind from the report heading', () => {
    expect(reportTerms(petReport).modalities).toEqual(new Set(['PET-CT']))
    expect(reportTerms(ctReport).modalities).toEqual(new Set(['CT']))
    expect(reportTerms(ctReport).body.has('chest')).toBe(true)
  })
  it('proposes a report on the same date for the same kind of study', () => {
    const p = proposePairs([scan('s', {})], [rep('r', petReport)])
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ scanId: 's', reportId: 'r' })
    expect(p[0].reason).toContain('same date')
  })
  it('allows a few days apart but not more', () => {
    expect(proposePairs([scan('s', {})], [rep('r', petReport, { date: '2026-05-01' })])).toHaveLength(1)
    expect(proposePairs([scan('s', {})], [rep('r', petReport, { date: '2026-05-02' })])).toHaveLength(0)
  })
  it('does not pair a CT report with a PET-CT study or a chest CT with a brain scan', () => {
    expect(proposePairs([scan('s', {})], [rep('r', ctReport)])).toHaveLength(0)
    expect(proposePairs([scan('s', { modality: 'CT', bodyKey: 'brain' })], [rep('r', ctReport)])).toHaveLength(0)
  })
  it('gives each scan one report and each report one scan, best first', () => {
    const p = proposePairs([scan('s1', {}), scan('s2', { date: '2026-04-27' })], [rep('r1', petReport), rep('r2', petReport, { date: '2026-04-27' })])
    expect(p.map((x) => `${x.scanId}>${x.reportId}`).sort()).toEqual(['s1>r1', 's2>r2'])
  })
  it('never offers a pair a person turned down, and moves on to the next best', () => {
    const blocked = new Set(['s|r1'])
    const p = proposePairs([scan('s', {})], [rep('r1', petReport), rep('r2', petReport, { date: '2026-04-29' })], blocked)
    expect(p.map((x) => x.reportId)).toEqual(['r2'])
  })
  it('shows a proposal as possible until it is confirmed', () => {
    const open = resolvePairs([scan('s', {})], [rep('r', petReport)], [])
    expect(open).toEqual([expect.objectContaining({ scanId: 's', reportId: 'r', state: 'possible', linkId: null })])
    const done = resolvePairs([scan('s', {})], [rep('r', petReport)], [{ id: 'L1', aId: 's', bId: 'r', state: 'confirmed' }])
    expect(done).toEqual([expect.objectContaining({ state: 'confirmed', linkId: 'L1' })])
    const gone = resolvePairs([scan('s', {})], [rep('r', petReport)], [{ id: 'L1', aId: 's', bId: 'r', state: 'rejected' }])
    expect(gone).toEqual([])
  })
  it('keeps a confirmed pair out of later proposals', () => {
    const out = resolvePairs([scan('s', {})], [rep('r', petReport), rep('r2', petReport)], [{ id: 'L1', aId: 's', bId: 'r', state: 'confirmed' }])
    expect(out).toHaveLength(1)
  })
})

describe('earlier studies of the same area', () => {
  const rows = [
    row({ id: 'now', flags: imaging(['CT'], '2026-04-12', 'CHEST') }),
    row({ id: 'old1', flags: imaging(['CT'], '2026-02-10', 'CHEST') }),
    row({ id: 'old2', flags: imaging(['CT'], '2025-11-01', 'CHEST') }),
    row({ id: 'brain', flags: imaging(['CT'], '2026-01-01', 'BRAIN') }),
    row({ id: 'mri', flags: imaging(['MR'], '2026-01-05', 'CHEST') }),
    row({ id: 'later', flags: imaging(['CT'], '2026-06-01', 'CHEST') }),
    row({ id: 'rep', docType: 'imaging_report', documentDate: '2026-02-10' }),
  ]
  it('lists earlier scans of the same kind and body part, newest first', () => {
    expect(earlierStudies(rows, 'now').map((r) => r.id)).toEqual(['old1', 'old2'])
  })
  it('gives nothing for a report or for the oldest scan', () => {
    expect(earlierStudies(rows, 'rep')).toEqual([])
    expect(earlierStudies(rows, 'old2')).toEqual([])
  })
})

describe('finale review fixes (RAD-08, RAD-11, RAD-13, RAD-17)', () => {
  it('says plainly when the hospitals differ', () => {
    const scan: ScanCandidate = { id: 's', date: '2026-04-28', institution: 'Synthetic Demo Imaging Centre', modality: 'PET-CT', bodyKey: null }
    const rep: ReportCandidate = { id: 'r', date: '2026-04-28', institution: 'City Care Hospital', terms: reportTerms('PET-CT whole body report') }
    expect(proposePairs([scan], [rep])[0].reason).toBe('same date, same kind of study, different hospital')
    expect(proposePairs([scan], [{ ...rep, institution: null }])[0].reason).toBe('same date, same kind of study')
  })
  it('lists same-body-part studies of another kind, earlier only', () => {
    const rows = [
      row({ id: 'us', flags: imaging(['US'], '2026-01-08', 'BREAST') }),
      row({ id: 'mg', flags: imaging(['MG'], '2026-01-05', 'BREAST') }),
      row({ id: 'late', flags: imaging(['MG'], '2026-03-05', 'BREAST') }),
      row({ id: 'chest', flags: imaging(['CR'], '2026-01-04', 'CHEST') }),
    ]
    expect(otherAreaStudies(rows, 'us').map((r) => r.id)).toEqual(['mg'])
    expect(earlierStudies(rows, 'us')).toEqual([])
  })
  it('brings matching imaging reports into a scan-kind filter only when asked', () => {
    const scanRow = row({ id: 's', flags: imaging(['CT'], '2025-11-10', 'CHEST') })
    const repRow = { ...row({ id: 'r', docType: 'imaging_report', documentDate: '2025-11-10' }), reportMods: ['CT' as const] }
    const lab = row({ id: 'l', docType: 'lab_report', documentDate: '2025-11-10' })
    expect(filterRecords([scanRow, repRow, lab], { modality: 'CT' }).map((r) => r.id)).toEqual(['s'])
    expect(filterRecords([scanRow, repRow, lab], { modality: 'CT', withReports: true }).map((r) => r.id)).toEqual(['s', 'r'])
  })
  it('picks the same summary line however the facts were created', () => {
    const lines = [{ rank: 12, text: 'Metformin' }, { rank: 0, text: 'Cycle 1 · Capecitabine' }, { rank: 12, text: 'Urea 10% emollient cream' }]
    const pick = (xs: typeof lines) => xs.reduce<{ rank: number; text: string } | null>((a, b) => betterHeadline(a, b), null)
    expect(pick(lines)?.text).toBe('Cycle 1 · Capecitabine')
    expect(pick([...lines].reverse())?.text).toBe('Cycle 1 · Capecitabine')
    expect(pick(lines.slice(0, 1).concat(lines.slice(2)))?.text).toBe(pick(lines.slice(2).concat(lines.slice(0, 1)))?.text)
  })
})

describe('one study in several uploads', () => {
  const part = (id: string, at: string, n: number, uid: string | null): RecordRow => ({ id, receivedAt: at, scan: { studyUid: uid, instances: n, frames: n, modality: 'MR', bodyKey: 'head', studyDate: '2025-12-09' } } as unknown as RecordRow)
  it('merges parts with the same StudyInstanceUID into one row, the first to arrive, with the counts added', () => {
    const rows = [part('b', '2026-11-02', 700, 'U1'), part('a', '2026-11-01', 10, 'U1'), part('c', '2026-11-03', 5, 'U2'), part('d', '2026-11-03', 5, null)]
    const out = collapseStudyParts(rows)
    expect(out.map((r) => r.id)).toEqual(['a', 'c', 'd'])
    expect(out[0].scan).toMatchObject({ instances: 710, frames: 710, parts: 2 })
  })
  it('counts each part as the pictures the viewer steps through (a single multi-frame file counts its frames)', () => {
    const multi = { ...part('m', '2026-11-01', 1, 'U3'), scan: { ...part('m', '2026-11-01', 1, 'U3').scan!, frames: 9 } }
    const out = collapseStudyParts([multi, part('n', '2026-11-02', 5, 'U3')])
    expect(out).toHaveLength(1)
    expect(out[0].scan).toMatchObject({ instances: 14, frames: 14, parts: 2 })
  })
  it('earlier studies still list one row per earlier study, never another part of this one', () => {
    const ct = (id: string, received: string, studyDate: string, studyUid: string, n: number) =>
      row({ id, mime: 'application/x-dicom-study', receivedAt: received, flags: { imaging: { ...imaging(['CT'], studyDate, 'CHEST').imaging, studyUid, instances: n, frames: n } } })
    const rows = collapseStudyParts([ct('p1', '2026-11-01T09:00:00.000Z', '2026-10-30', 'NOW', 400), ct('p2', '2026-11-02T09:00:00.000Z', '2026-10-30', 'NOW', 300), ct('old', '2026-03-01T09:00:00.000Z', '2026-02-27', 'OLD', 200)])
    expect(rows.map((r) => r.id)).toEqual(['p1', 'old'])
    expect(earlierStudies(rows, 'p1').map((r) => r.id)).toEqual(['old'])
  })
})

describe('applyLinkDecision (the list changes at once)', () => {
  const pair = { scanId: 's', reportId: 'r', state: 'possible' as const, reason: 'same day', linkId: null }
  it('rejecting drops the pair and keeps it undoable from either side', () => {
    const o = applyLinkDecision([pair], [], { scanId: 's', reportId: 'r', decision: 'reject' })
    expect(o.pairs).toEqual([])
    expect(o.rejected).toEqual([{ scanId: 's', reportId: 'r' }])
  })
  it('undoing forgets the rejection; confirming links it', () => {
    expect(applyLinkDecision([], [{ scanId: 's', reportId: 'r' }], { scanId: 's', reportId: 'r', decision: 'reset' }).rejected).toEqual([])
    const c = applyLinkDecision([pair], [], { scanId: 's', reportId: 'r', decision: 'confirm' })
    expect(c.pairs).toMatchObject([{ state: 'confirmed' }])
  })
})

describe('earlier studies a report compares with (25 Nov 2026)', () => {
  const NOW = '2026-11-20'
  it('reads the date after "dated" when a study is named before it', () => {
    const text = [
      'IMPRESSION: The lesion is smaller when compared to the MRI dated 12 February 2025 and stable since.',
      'Previous scan dated 09/04/2025 is available for comparison.',
      'Compared with previous PET/CT dated 26/08/2025. Follow-up PET/CT scan shows no new uptake.',
      'Comparison: Multiple MRI studies of the brain. Last MRI study dated 12/2025',
    ].join('\n')
    expect(comparedDates(text, NOW, null)).toEqual([
      { date: '2025-02-12', month: false }, { date: '2025-04-09', month: false }, { date: '2025-08-26', month: false }, { date: '2025-12', month: true },
    ])
  })
  it('a dated header, an illegible date and the report\'s own date are not comparisons', () => {
    expect(comparedDates('Dated: 12/02/2025\nReport dated 10/10/2026', NOW, null)).toEqual([])
    expect(comparedDates('compared to previous MRI dated 12/02/5', NOW, null)).toEqual([])
    expect(comparedDates('MRI dated 10/10/2026 (this study)', NOW, '2026-10-10')).toEqual([])
  })
  it('links to the paper of that day (a report before a scan), a month only when one paper fits, both ways', () => {
    const r = (id: string, date: string, kind: RecordRow['kind'] = 'report', docId = id) => ({ id, docId, kind, docType: kind === 'report' ? 'imaging_report' : null, date, dateFrom: 'paper' as const })
    const rows = [r('mri-2026', '2026-10-10'), r('mri-feb', '2025-02-12'), r('mri-feb-2', '2025-02-12'), r('ct-feb', '2025-02-12', 'scan'), r('mri-dec', '2025-12-09'), r('a', '2025-07-11'), r('b', '2025-07-20')]
    const asked = [{ date: '2025-02-12', month: false }, { date: '2025-12', month: true }, { date: '2025-07', month: true }, { date: '2024-01-01', month: false }]
    const out = linkComparisons(rows, new Map([['mri-2026', asked]]))
    expect(out.find((x) => x.id === 'mri-2026')!.compared!.map((c) => c.rowIds)).toEqual([['mri-feb', 'mri-feb-2'], ['mri-dec'], [], []]) // every report that day, never a pick
    expect(out.find((x) => x.id === 'mri-feb')!.comparedBy).toEqual(['mri-2026'])
    expect(out.find((x) => x.id === 'ct-feb')!.comparedBy).toBeUndefined() // a report that day comes before a scan
    // A report in a file of several names its own file's study first.
    const folder = [...rows, r('f.1', '2025-02-12', 'report', 'f'), r('f.2', '2026-10-10', 'report', 'f')]
    expect(linkComparisons(folder, new Map([['f.2', [asked[0]]]])).find((x) => x.id === 'f.2')!.compared![0].rowIds).toEqual(['f.1'])
    // Only a scan that day: the scan.
    expect(linkComparisons([r('x', '2026-01-01'), r('s', '2025-03-03', 'scan')], new Map([['x', [{ date: '2025-03-03', month: false }]]]))[0].compared![0].rowIds).toEqual(['s'])
    expect(fmtCompared({ date: '2025-12', month: true })).toBe('Dec 2025')
  })
})

