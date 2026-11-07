import { describe, expect, it } from 'vitest'
import { describeAction, describeTarget } from './audit-words'

describe('describeAction', () => {
  it('names the common entries', () => {
    expect(describeAction('event.source_viewed')).toBe('Opened the page behind a fact')
    expect(describeAction('snapshot.seal')).toBe('Visit sealed')
  })
  it('never prints a raw code for an unknown entry', () => {
    const t = describeAction('some.new_thing')
    expect(t).toBe('Some new thing')
    expect(t).not.toMatch(/[._]/)
  })
  it('handles an empty action', () => {
    expect(describeAction('')).toBe('Activity')
  })
  it('names targets', () => {
    expect(describeTarget('share_link')).toBe('Share link')
    expect(describeTarget(null)).toBe('—')
    expect(describeTarget('odd_kind')).toBe('odd kind')
  })
})
