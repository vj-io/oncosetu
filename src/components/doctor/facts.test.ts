import { describe, expect, it } from 'vitest'
import { dedupeFacts, foldList, placeFromWording, quoteBelow, sameWords } from './facts'

const f = (o: { text: string; kind?: string; dateIso?: string | null; quote?: string | null }) => ({ text: o.text, kind: o.kind ?? 'Follow-up', dateIso: o.dateIso ?? null, quote: o.quote ?? null })

describe('clinician overview helpers', () => {
  it('knows when two strings are the same words', () => {
    expect(sameWords('Follow up on 12 May 2026.', 'follow-up on 12 may 2026')).toBe(true)
    expect(sameWords('Review in OPD', 'review in opd.')).toBe(true)
    expect(sameWords('Review in OPD with reports', 'Review in OPD')).toBe(true)
    expect(sameWords('', 'x')).toBe(false)
  })
  it('prints a quote only when it adds words', () => {
    expect(quoteBelow(f({ text: 'Cycle 4 · AC-T', quote: 'Cycle 4 · AC-T' }))).toBeNull()
    expect(quoteBelow(f({ text: 'Cycle 4', quote: 'Chemotherapy cycle 4 of AC-T given today' }))).toBe('Chemotherapy cycle 4 of AC-T given today')
    expect(quoteBelow(f({ text: 'Cycle 4', quote: null }))).toBeNull()
  })
  it('shows a follow-up date once', () => {
    const list = [f({ text: 'Next visit', dateIso: '2026-06-02' }), f({ text: 'next  visit.', dateIso: '2026-06-02' }), f({ text: 'Next visit', dateIso: '2026-07-02' })]
    expect(dedupeFacts(list)).toHaveLength(2)
  })
  it('folds a long list after the first few', () => {
    expect(foldList([1, 2, 3, 4, 5], 2)).toEqual({ shown: [1, 2], rest: [3, 4, 5] })
    expect(foldList([1], 2)).toEqual({ shown: [1], rest: [] })
  })
  it('takes the place out of a missing-paper sentence', () => {
    expect(placeFromWording('Prescription the patient mentioned from City Care Hospital, Nagpur')).toBe('City Care Hospital, Nagpur')
    expect(placeFromWording('Prescription from City Care Hospital, Nagpur is not in file (patient statement)')).toBe('City Care Hospital, Nagpur')
    expect(placeFromWording('Histopathology report')).toBeNull()
  })
})

import { newestFirst } from './facts'
describe('newest first', () => {
  it('puts the latest date on top and undated last', () => {
    const l = [{ id: 'a', dateIso: '2026-01-01' }, { id: 'b', dateIso: null }, { id: 'c', dateIso: '2026-03-01' }, { id: 'd', dateIso: '2026-03-01' }]
    expect(newestFirst(l).map((x) => x.id)).toEqual(['c', 'd', 'a', 'b'])
  })
})
