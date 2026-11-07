import { describe, expect, it } from 'vitest'
import { heard, norm, wer } from './asr'

describe('eval-asr scoring', () => {
  it('normalises case, punctuation, danda and nukta', () => {
    expect(norm('Tab. CAPECITABINE, twice!')).toBe('tab capecitabine twice')
    expect(norm('मैं रोज़ सुबह लेती हूँ।')).toBe(norm('मैं रोज सुबह लेती हूँ'))
  })
  it('scores word error rate against the reference', () => {
    expect(wer('I am taking Capecitabine twice a day after food', 'I am taking Capecitabine twice a day after food.')).toBe(0)
    expect(wer('I am taking capacita bin twice a day after food', 'I am taking Capecitabine twice a day after food')).toBeCloseTo(2 / 9)
  })
  it('counts a drug as heard only when every word of its name is there, in order', () => {
    expect(heard('main roz Zoledronic acid leti hoon', 'Zoledronic acid')).toBe(true)
    expect(heard('main roz zoledronic acidity', 'Zoledronic acid')).toBe(false)
    expect(heard('tap capacita bin', 'Capecitabine')).toBe(false)
  })
})
