import { describe, expect, it } from 'vitest'
import { countNewSinceSeal, parseSealedCopy } from './new-since-seal'

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
