import { describe, expect, it } from 'vitest'
import { buildFirstLook, classifyHeld, type FirstLookInput } from './first-look'
import { oncologyView, isEmptyOncology, type FactItem } from './oncology'
import type { EventType } from '../types'

const item = (id: string, eventType: EventType, over: Partial<FactItem> = {}): FactItem => ({
  id, eventType, headline: null, status: 'unverified', statusLabel: 'Not yet verified', fields: [],
  sources: [{ docLabel: 'Histopathology report', pageNo: 1, quote: `quote ${id}`, href: `/d/${id}` }], when: { event: '1 Jan 2026', eventIso: '2026-01-01' }, ...over,
})

describe('oncologyView', () => {
  it('puts facts in the fixed oncology sections', () => {
    const v = oncologyView([
      item('a', 'diagnosis_documented'), item('b', 'pathology_report_documented'), item('c', 'stage_documented'),
      item('d', 'marker_results_documented'), item('e', 'margins_documented'), item('f', 'allergy_documented'),
      item('g', 'prescription_documented'), item('h', 'follow_up_documented'), item('i', 'lab_report_documented'),
    ])
    expect(v.diagnosis.map((f) => f.id).sort()).toEqual(['a', 'b'])
    expect(v.stage.map((f) => f.id)).toEqual(['c'])
    expect(v.markers.map((f) => f.id)).toEqual(['d'])
    expect(v.margins.map((f) => f.id)).toEqual(['e'])
    expect(v.allergies.map((f) => f.id)).toEqual(['f'])
    expect(v.medicines.map((f) => f.id)).toEqual(['g'])
    expect(v.followUp.map((f) => f.id)).toEqual(['h'])
    expect(Object.values(v).flat().find((f) => f.id === 'i')).toBeUndefined() // labs are not in the strip
  })
  it('orders treatment oldest first with undated last', () => {
    const v = oncologyView([
      item('late', 'chemotherapy_session_documented', { when: { event: '12 May 2026', eventIso: '2026-05-12' } }),
      item('undated', 'imaging_report_documented', { when: { event: 'Date not stated', eventIso: null } }),
      item('early', 'procedure_documented', { when: { event: '12 Mar 2026', eventIso: '2026-03-12' } }),
    ])
    expect(v.treatment.map((f) => f.id)).toEqual(['early', 'late', 'undated'])
    expect(v.treatment[0].kind).toBe('Procedure or surgery')
  })
  it('uses only the document words and never invents text', () => {
    const v = oncologyView([item('s', 'stage_documented', { headline: 'pT3 pN1b', sources: [] })])
    expect(v.stage[0].text).toBe('pT3 pN1b')
    expect(v.stage[0].quote).toBeNull()
    const none = oncologyView([item('x', 'stage_documented', { headline: null, sources: [], fields: [] })])
    expect(none.stage[0].text).toBe('—')
  })
  it('knows when there is nothing to show', () => {
    expect(isEmptyOncology(oncologyView([]))).toBe(true)
    expect(isEmptyOncology(oncologyView([item('a', 'diagnosis_documented')]))).toBe(false)
  })
  it('marks verified facts', () => {
    expect(oncologyView([item('a', 'diagnosis_documented', { status: 'verified_matches_source' })]).diagnosis[0].verified).toBe(true)
  })
})

const base: FirstLookInput = {
  patientId: 'P', seal: null, newTotal: 0, newItems: [], amended: 0, patientSaid: 0, conflicts: [], missing: [], held: [], unverified: 0, disputed: 0,
}

describe('buildFirstLook', () => {
  it('always returns the six rows in the same order', () => {
    expect(buildFirstLook(base).map((r) => r.key)).toEqual(['new', 'missing', 'held', 'conflicts', 'unverified', 'sealed'])
  })
  it('links every row to its detail', () => {
    for (const r of buildFirstLook({ ...base, seal: { id: 'S', seq: 0, sealedLabel: '16 Feb 2026, 10:31 IST', signerName: 'Dr. Meera Iyer' } })) {
      expect(r.href).toMatch(/^\/(patients\/P|verify\/S)/)
    }
  })
  it('lists missing papers with where to ask', () => {
    const r = buildFirstLook({ ...base, missing: [{ id: 'm1', title: 'Histopathology report is not in file', askAt: 'Dhanvantari Hospital', state: 'expected' }, { id: 'm2', title: 'Lab report', askAt: null, state: 'expected' }] })[1]
    expect(r.count).toBe(2)
    expect(r.details[0].meta).toBe('Ask at Dhanvantari Hospital')
    expect(r.details[1].meta).toBe('Place not stated')
    expect(r.details[0].href).toBe('/patients/P/completeness#m-m1')
  })
  it('describes the last seal with date and signer', () => {
    const r = buildFirstLook({ ...base, seal: { id: 'S', seq: 0, sealedLabel: '16 Feb 2026, 10:31 IST', signerName: 'Dr. Meera Iyer' } })[5]
    expect(r.summary).toContain('16 Feb 2026')
    expect(r.summary).toContain('Dr. Meera Iyer')
  })
  it('clips long quotes and keeps them as quotes', () => {
    const r = buildFirstLook({ ...base, newItems: [{ id: 'n', typeLabel: 'Imaging report', headline: 'CT', when: '1 Jan', quote: 'x'.repeat(400) }] })[0]
    expect(r.details[0].quote!.length).toBeLessThanOrEqual(90)
  })
  it('labels the first row differently before any seal', () => {
    expect(buildFirstLook(base)[0].label).toBe('items on file (no visit sealed yet)')
    expect(buildFirstLook({ ...base, seal: { id: 'S', seq: 0, sealedLabel: 'x', signerName: null } })[0].label).toBe('New since the last sealed visit')
  })
  it('never uses an interpretive word', () => {
    const text = JSON.stringify(buildFirstLook({ ...base, unverified: 3, conflicts: [{ key: 'k', label: 'Two dates for one procedure' }] }))
    expect(text).not.toMatch(/progress|worsen|abnormal|risk|urgent|recommend/i)
  })
})

describe('classifyHeld', () => {
  it('puts a wrong patient first', () => {
    expect(classifyHeld({ identityResult: 'mismatch', handwritten: true, lowConfidence: true })).toBe('wrong_patient')
  })
  it('then handwriting', () => {
    expect(classifyHeld({ identityResult: 'insufficient', handwritten: true, lowConfidence: false })).toBe('handwriting')
  })
  it('then an unclear identity, then reading quality', () => {
    expect(classifyHeld({ identityResult: 'insufficient', handwritten: false, lowConfidence: false })).toBe('identity_unclear')
    expect(classifyHeld({ identityResult: 'match', handwritten: false, lowConfidence: true })).toBe('low_quality')
  })
})

describe('date-only imaging', () => {
  const img = (id: string, quote: string, type: EventType = 'imaging_report_documented', doc = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'): FactItem =>
    item(id, type, { sources: [{ docLabel: 'Imaging report', pageNo: 1, quote, href: `/patients/p/documents/${doc}?event=${id}` }] })
  it('hides a date-only imaging fact when the same document has an impression', async () => {
    const { oncologyView } = await import('./oncology')
    const v = oncologyView([img('a', 'Report Date: 18/11/2024'), img('b', 'Impression: no suspicious lesion.', 'impression_documented')])
    expect(v.treatment.map((f) => f.id)).toEqual(['b'])
  })
  it('keeps it when there is no impression, or when the quote says more', async () => {
    const { oncologyView } = await import('./oncology')
    expect(oncologyView([img('a', 'Date of Scan: 20/02/2026')]).treatment.map((f) => f.id)).toEqual(['a'])
    const v = oncologyView([img('a', 'CT thorax dated 20/02/2026 was reviewed'), img('b', 'Impression: x', 'impression_documented')])
    expect(v.treatment.map((f) => f.id).sort()).toEqual(['a', 'b'])
  })
  it('keeps it when the impression is in another document', async () => {
    const { oncologyView } = await import('./oncology')
    const v = oncologyView([img('a', 'Report Date: 18/11/2024'), img('b', 'Impression: x', 'impression_documented', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')])
    expect(v.treatment).toHaveLength(2)
  })
})

describe('noisy pathology rows', () => {
  const row = (id: string, type: EventType, quote: string, doc = 'cccccccc-cccc-cccc-cccc-cccccccccccc'): FactItem =>
    item(id, type, { sources: [{ docLabel: 'Histopathology report', pageNo: 1, quote, href: `/patients/p/documents/${doc}?event=${id}` }] })
  it('hides date-only and heading-only rows when the document says something', async () => {
    const { oncologyView, isDateOnlyQuote } = await import('./oncology')
    expect(isDateOnlyQuote('Date Reported: 22/01/2026')).toBe(true)
    expect(isDateOnlyQuote('Addendum Date: 30/01/2026')).toBe(true)
    expect(isDateOnlyQuote('Wide local excision done on 12/03/2026')).toBe(false)
    const v = oncologyView([row('a', 'pathology_report_documented', 'HISTOPATHOLOGY'), row('b', 'pathology_report_documented', 'Date Reported: 22/01/2026'), row('c', 'margins_documented', 'Margins are free of tumour.')])
    expect(v.diagnosis).toHaveLength(0)
    expect(v.margins).toHaveLength(1)
  })
  it('keeps a row that is the only fact of its document', async () => {
    const { oncologyView } = await import('./oncology')
    expect(oncologyView([row('a', 'pathology_report_documented', 'HISTOPATHOLOGY')]).diagnosis).toHaveLength(1)
  })
})
