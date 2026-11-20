import { describe, expect, it } from 'vitest'
import { startOfIstDay, verifiedToday } from './desk-window'

describe('desk reopen window (decision 19)', () => {
  const at = new Date('2026-11-20T18:00:00+05:30')
  it('allows a check-in from earlier the same IST day, including just after midnight', () => {
    expect(verifiedToday(new Date('2026-11-20T00:00:01+05:30'), at)).toBe(true)
    expect(verifiedToday(new Date('2026-11-20T09:00:00+05:30'), at)).toBe(true)
  })
  it('refuses yesterday, even if it was under 12 hours ago', () => {
    expect(verifiedToday(new Date('2026-11-19T23:59:59+05:30'), new Date('2026-11-20T03:00:00+05:30'))).toBe(false)
    expect(verifiedToday(new Date('2026-11-19T10:00:00+05:30'), at)).toBe(false)
  })
  it('ends at midnight IST', () => {
    expect(verifiedToday(new Date('2026-11-20T23:00:00+05:30'), new Date('2026-11-20T23:59:59+05:30'))).toBe(true)
    expect(verifiedToday(new Date('2026-11-20T23:00:00+05:30'), new Date('2026-11-21T00:00:00+05:30'))).toBe(false)
  })
  it('uses IST, not UTC, for the day boundary', () => {
    expect(startOfIstDay(new Date('2026-11-20T20:00:00Z')).toISOString()).toBe('2026-11-20T18:30:00.000Z') // 21 Nov 01:30 IST
  })
})
