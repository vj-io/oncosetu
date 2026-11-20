import { describe, expect, it } from 'vitest'
import { countNewSinceSeal, newestItemsFirst, newItemTotal, parseSealedCopy } from './new-since-seal'

describe('countNewSinceSeal', () => {
  const sealed = { verified: [{ id: 'a' }], unverified: [{ id: 'b' }] }
  it('counts items that are not in the sealed copy, whatever their dates', () => {
    expect(countNewSinceSeal(['a', 'b', 'c', 'd'], sealed)).toBe(2)
  })
  it('counts everything when nothing is sealed', () => {
    expect(countNewSinceSeal(['a', 'b'], null)).toBe(2)
  })
  it('is zero when the record is exactly what was sealed', () => {
    expect(countNewSinceSeal(['a', 'b'], sealed)).toBe(0)
  })
})

describe('parseSealedCopy', () => {
  it('reads a stored copy and ignores broken text', () => {
    expect(parseSealedCopy('{"verified":[{"id":"a"}],"unverified":[]}')).toEqual({ verified: [{ id: 'a' }], unverified: [] })
    expect(parseSealedCopy('nope')).toBeNull()
    expect(parseSealedCopy('{"verified":1}')).toBeNull()
    expect(parseSealedCopy(null)).toBeNull()
  })
})

describe('newItemTotal', () => {
  const ev = (a: number, b: number, c: number, d: number) => ({ initial_record: Array(a), new_since_last_visit: Array(b), newly_received_older: Array(c), amended: Array(d) })
  it('counts what the What is new page lists: everything before a seal, new + late + corrected after it', () => {
    expect(newItemTotal({ mode: 'initial', events: ev(39, 0, 0, 0) })).toBe(39)
    expect(newItemTotal({ mode: 'diff', events: ev(0, 15, 2, 5) })).toBe(22)
  })
})

describe('newestItemsFirst', () => {
  it('puts the newest date first, undated last, and keeps the order of equal dates', () => {
    const l = [{ id: 'a', when: { eventIso: '2024-03-01' } }, { id: 'b', when: { eventIso: null } }, { id: 'c', when: { eventIso: '2026-04-28' } }, { id: 'd', when: { eventIso: '2026-04-28' } }]
    expect(newestItemsFirst(l).map((x) => x.id)).toEqual(['c', 'd', 'a', 'b'])
  })
})
