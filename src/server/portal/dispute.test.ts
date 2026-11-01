import { describe, expect, it } from 'vitest'
import { eventsToDispute } from './dispute'

const e = (id: string, verificationStatus = 'unverified', extra: { withdrawnAt?: Date; supersedesId?: string } = {}) =>
  ({ id, verificationStatus, withdrawnAt: extra.withdrawnAt ?? null, supersedesId: extra.supersedesId ?? null })

describe('eventsToDispute (J7, patient side)', () => {
  it('takes every live event whatever its verification status', () => {
    const rows = [e('a'), e('b', 'verified_matches_source'), e('c', 'edited')]
    expect(eventsToDispute(rows).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
  it('skips events already disputed, rejected, withdrawn or replaced by an edit', () => {
    const rows = [e('old', 'unverified'), e('new', 'edited', { supersedesId: 'old' }), e('d', 'disputed'), e('r', 'rejected'), e('w', 'unverified', { withdrawnAt: new Date() }), e('ok')]
    expect(eventsToDispute(rows).map((r) => r.id)).toEqual(['new', 'ok'])
  })
  it('is empty for a document with no extracted events', () => {
    expect(eventsToDispute([])).toEqual([])
  })
})
