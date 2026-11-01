import { describe, expect, it } from 'vitest'
import { canSecondReview, disagreementRate, isoWeek, selectQaSample } from './qa-core'

const items = (n: number, week = '2026-11-02') => Array.from({ length: n }, (_, i) => ({ id: `v-${week}-${i}`, at: new Date(`${week}T10:00:00Z`) }))

describe('selectQaSample', () => {
  it('takes ceil(5%) per ISO week', () => {
    expect(selectQaSample(items(100))).toHaveLength(5)
    expect(selectQaSample(items(101))).toHaveLength(6)
    expect(selectQaSample(items(1))).toHaveLength(1)
    expect(selectQaSample([...items(100), ...items(40, '2026-10-26')])).toHaveLength(5 + 2)
  })
  it('is reproducible and independent of input order', () => {
    const xs = items(60)
    const a = selectQaSample(xs).map((x) => x.id)
    const b = selectQaSample([...xs].reverse()).map((x) => x.id)
    expect(new Set(a)).toEqual(new Set(b))
    expect(selectQaSample(xs).map((x) => x.id)).toEqual(a)
  })
  it('returns nothing for no verifications', () => {
    expect(selectQaSample([])).toEqual([])
  })
})

describe('isoWeek', () => {
  it('follows ISO-8601 around the year boundary', () => {
    expect(isoWeek(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01')
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53')
    expect(isoWeek(new Date('2026-11-02T10:00:00Z'))).toBe('2026-W45')
  })
})

describe('second review', () => {
  it('computes the disagreement rate and has no rate with no reviews', () => {
    expect(disagreementRate([{ outcome: 'agree' }, { outcome: 'disagree' }, { outcome: 'agree' }, { outcome: 'agree' }])).toEqual({ reviewed: 4, disagree: 1, rate: 0.25 })
    expect(disagreementRate([]).rate).toBeNull()
  })
  it('requires a different person than the verifier', () => {
    expect(canSecondReview('a', 'a')).toBe(false)
    expect(canSecondReview('b', 'a')).toBe(true)
  })
})
