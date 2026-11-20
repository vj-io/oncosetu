import { describe, expect, it } from 'vitest'
import { accession, plural, shortId } from './format'

describe('admin display helpers', () => {
  it('pluralises one correctly', () => {
    expect(`1 ${plural(1, 'entry', 'entries')}`).toBe('1 entry')
    expect(`2 ${plural(2, 'entry', 'entries')}`).toBe('2 entries')
    expect(`1 capture ${plural(1, 'device')}`).toBe('1 capture device')
    expect(plural(0, 'device')).toBe('devices')
  })
  it('short ids use the end of the id, so time-ordered ids differ', () => {
    const a = '01a1f4dd-67e4-7000-8000-0000000b7f39', b = '01a1f4dd-67e4-7000-8000-0000000c1a22'
    expect(shortId(a)).not.toBe(shortId(b))
    expect(shortId(null)).toBe('—')
    expect(accession(a)).toBe('OS·0B7F39')
  })
})
