import { describe, expect, it } from 'vitest'
import { mergeNoAnswers } from './ledger-view'

const s = (id: string, question: string, transcript: string, extra: Partial<{ medicines: string[]; scans: string[]; institution: string | null }> = {}) =>
  ({ id, question, transcript, medicines: [], scans: [], institution: null, ...extra })

describe('mergeNoAnswers', () => {
  it('folds two plain "No" answers into one line', () => {
    const r = mergeNoAnswers([s('1', 'Hospital admissions', 'No'), s('2', 'Anything else', 'No.'), s('3', 'New medicines', 'I take letrozole', { medicines: ['letrozole'] })])
    expect(r.noLine).toBe('No to: hospital admissions, anything else.')
    expect(r.rest.map((x) => x.id)).toEqual(['3'])
  })
  it('keeps a single "No" as its own card', () => {
    const r = mergeNoAnswers([s('1', 'Hospital admissions', 'No')])
    expect(r.noLine).toBeNull()
    expect(r.rest).toHaveLength(1)
  })
  it('never folds an answer that carries content', () => {
    const r = mergeNoAnswers([s('1', 'A', 'No'), s('2', 'B', 'No, but I saw Dr Rao at City Hospital', { institution: 'City Hospital' }), s('3', 'C', 'No')])
    expect(r.rest.map((x) => x.id)).toEqual(['2'])
  })
  it('understands Hindi', () => {
    expect(mergeNoAnswers([s('1', 'A', 'नहीं'), s('2', 'B', 'नहीं')]).noLine).toContain('a, b')
  })
})
