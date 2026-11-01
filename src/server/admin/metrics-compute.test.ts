import { describe, expect, it } from 'vitest'
import {
  correctionRates, disclosurePrevalence, documentCensus, median, previsitCompletion, provenance, radarMetrics,
  requestFulfilment, safetyKpis, type MissingRow,
} from './metrics-compute'

const d = (s: string) => new Date(s)

describe('median', () => {
  it('handles empty, odd and even', () => {
    expect(median([])).toBeNull()
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('provenance', () => {
  const ev = (eventType: string, evidenceCount: number, extra: object = {}) => ({ eventType, evidenceCount, verificationStatus: 'unverified', withdrawn: false, ...extra })
  it('counts evidence rows and patient statements as supported, reports the rest as unsupported', () => {
    const r = provenance([ev('procedure_documented', 1), ev('patient_statement', 0), ev('lab_report_documented', 0), ev('lab_report_documented', 0)])
    expect(r.coverage).toEqual({ num: 2, den: 4 })
    expect(r.unsupported).toBe(2)
    expect(r.unsupportedByType).toEqual({ lab_report_documented: 2 })
  })
  it('ignores withdrawn and rejected events', () => {
    const r = provenance([ev('lab_report_documented', 0, { withdrawn: true }), ev('lab_report_documented', 0, { verificationStatus: 'rejected' }), ev('lab_report_documented', 2)])
    expect(r).toMatchObject({ coverage: { num: 1, den: 1 }, unsupported: 0 })
  })
  it('has no denominator for an empty record (not 100%)', () => {
    expect(provenance([]).coverage).toEqual({ num: 0, den: 0 })
  })
})

describe('correctionRates', () => {
  it('is edited+rejected over verified, per document type, ignoring unverified/disputed', () => {
    const r = correctionRates([
      { docType: 'pathology_report', status: 'verified_matches_source' },
      { docType: 'pathology_report', status: 'edited' },
      { docType: 'pathology_report', status: 'rejected' },
      { docType: 'pathology_report', status: 'unverified' },
      { docType: 'pathology_report', status: 'disputed' },
      { docType: 'imaging_report', status: 'verified_matches_source' },
      { docType: null, status: 'edited' },
    ])
    expect(r.byType).toEqual([
      { docType: 'pathology_report', num: 2, den: 3 },
      { docType: 'imaging_report', num: 0, den: 1 },
      { docType: 'no_document', num: 1, den: 1 },
    ])
    expect(r.total).toEqual({ num: 3, den: 5 })
  })
})

describe('radarMetrics', () => {
  const item = (o: Partial<MissingRow>): MissingRow => ({
    patientId: 'p1', mode: 'production', state: 'expected', createdAt: d('2026-01-01'), stateChangedAt: d('2026-01-01'), hasRequest: false, ...o,
  })
  const snaps = new Map([['p1', [d('2026-02-01'), d('2026-03-01')]]])
  it('counts an item closed before the NEXT sealed snapshot only', () => {
    const r = radarMetrics([
      item({ state: 'closed', stateChangedAt: d('2026-01-20') }), // before 1 Feb: counts
      item({ state: 'closed', stateChangedAt: d('2026-02-10') }), // after the next snapshot: does not
      item({ state: 'received', stateChangedAt: d('2026-02-01') }), // exactly at the snapshot: counts
      item({ state: 'expected' }),
    ], snaps)
    expect(r.closure).toEqual({ num: 2, den: 4 })
    expect(r).toMatchObject({ detected: 4, received: 3, closed: 2, awaitingSnapshot: 0 })
  })
  it('leaves items with no later snapshot out of the denominator and ignores shadow items in production counts', () => {
    const r = radarMetrics([
      item({ patientId: 'p2', state: 'closed' }),
      item({ mode: 'shadow', state: 'closed', stateChangedAt: d('2026-01-02') }),
    ], snaps)
    expect(r).toMatchObject({ detected: 1, shadow: 1, awaitingSnapshot: 1, closure: { num: 0, den: 0 } })
  })
  it('counts requested from linked requests or state', () => {
    const r = radarMetrics([item({ hasRequest: true, state: 'closed' }), item({ state: 'requested' }), item({})], snaps)
    expect(r.requested).toBe(2)
  })
})

describe('requestFulfilment', () => {
  it('takes median days over fulfilled requests and a rate over sent requests', () => {
    const r = requestFulfilment([
      { institutionType: null, sentAt: d('2026-01-01'), fulfilledAt: d('2026-01-05') }, // 4 d
      { institutionType: null, sentAt: d('2026-01-01'), fulfilledAt: d('2026-01-11') }, // 10 d
      { institutionType: null, sentAt: d('2026-01-01'), fulfilledAt: null },
      { institutionType: null, sentAt: null, fulfilledAt: null }, // draft: not sent
    ])
    expect(r.overall).toMatchObject({ sent: 3, fulfilled: 2, medianDays: 7, rate: { num: 2, den: 3 } })
    expect(r.byType).toHaveLength(1)
    expect(r.byType[0].institutionType).toBe('unknown')
  })
  it('reports no median when nothing is fulfilled', () => {
    expect(requestFulfilment([{ institutionType: 'govt', sentAt: d('2026-01-01'), fulfilledAt: null }]).overall.medianDays).toBeNull()
  })
})

describe('previsitCompletion', () => {
  const enc = (id: string, type = 'returning') => ({ id, patientId: 'p1', type, startedAt: d('2026-03-10T10:00:00Z') })
  it('counts returning encounters with a confirmed linked or recent unlinked statement', () => {
    const r = previsitCompletion(
      [enc('e1'), enc('e2'), enc('e3'), enc('e4', 'onboarding')],
      [
        { patientId: 'p1', encounterId: 'e1', confirmation: 'confirmed', createdAt: d('2026-03-10T11:00:00Z') },
        { patientId: 'p1', encounterId: null, confirmation: 'corrected', createdAt: d('2026-03-08T09:00:00Z') },
        { patientId: 'p1', encounterId: null, confirmation: 'pending', createdAt: d('2026-03-08T09:00:00Z') },
        { patientId: 'p1', encounterId: null, confirmation: 'confirmed', createdAt: d('2026-02-01T09:00:00Z') }, // too old
      ],
    )
    // e1 linked; e2 and e3 share the recent corrected statement (same patient, same start); onboarding excluded
    expect(r).toEqual({ num: 3, den: 3 })
  })
  it('does not count statements after the encounter started', () => {
    expect(previsitCompletion([enc('e1')], [{ patientId: 'p1', encounterId: null, confirmation: 'confirmed', createdAt: d('2026-03-11T00:00:00Z') }])).toEqual({ num: 0, den: 1 })
  })
})

describe('disclosurePrevalence / documentCensus', () => {
  it('treats not_cleared and unknown as non-cleared', () => {
    expect(disclosurePrevalence(['cleared', 'not_cleared', 'unknown', 'cleared'])).toMatchObject({ total: 4, cleared: 2, notCleared: 1, unknown: 1, nonCleared: { num: 2, den: 4 } })
    expect(disclosurePrevalence([]).nonCleared).toEqual({ num: 0, den: 0 })
  })
  it('splits pages into exclusive classes and overlays low confidence', () => {
    const c = documentCensus([
      { hasText: true, handwritten: false, lowConfidence: false },
      { hasText: true, handwritten: true, lowConfidence: true },
      { hasText: false, handwritten: true, lowConfidence: true }, // no text: image-only wins
      { hasText: true, handwritten: null, lowConfidence: false },
    ])
    expect(c).toEqual({ total: 4, printed: 2, handwritten: 1, imageOnly: 1, lowConfidence: 2 })
    expect(c.printed + c.handwritten + c.imageOnly).toBe(c.total)
  })
})

describe('safetyKpis', () => {
  const base = { wrongPatientAutoAttached: 0, unsupportedFacts: 0, qa: { reviewed: 0, disagree: 0 }, radarWordingHits: 0, radarTemplates: 20, diagnosisWordHits: 0, diagnosisSurfaceScanned: 5 }
  const by = (i: Parameters<typeof safetyKpis>[0]) => Object.fromEntries(safetyKpis(i).map((k) => [k.key, k]))
  it('marks zero targets on_target at 0 and breach above, and never fabricates unmeasured KPIs', () => {
    const ok = by(base)
    expect(ok.unsupported.status).toBe('on_target')
    expect(ok.qa_mismatch.status).toBe('not_measured')
    expect(ok.omissions.status).toBe('not_measured')
    expect(ok.privacy.status).toBe('not_measured')
    const bad = by({ ...base, unsupportedFacts: 2, wrongPatientAutoAttached: 1, diagnosisWordHits: 1 })
    expect([bad.unsupported.status, bad.wrong_patient.status, bad.diagnosis_words.status]).toEqual(['breach', 'breach', 'breach'])
  })
  it('judges the QA disagreement rate against 1%', () => {
    expect(by({ ...base, qa: { reviewed: 200, disagree: 1 } }).qa_mismatch.status).toBe('on_target')
    expect(by({ ...base, qa: { reviewed: 20, disagree: 1 } }).qa_mismatch.status).toBe('breach')
  })
})
