import { describe, expect, it } from 'vitest'
import {
  backoffMs, classifyResponse, isDue, markFailed, markPending, markSynced, overdue, QUEUE_ALERT_MS, retryNow, startSync,
  type CaptureMeta,
} from './queue-state'

const cap = (over: Partial<CaptureMeta> = {}): CaptureMeta => ({
  id: 'c1', state: 'pending', capturedAt: 1_000, pageCount: 2, attempts: 0, nextAttemptAt: null, lastError: null, offline: true, ...over,
})

describe('queue state machine (FR-OFF-02)', () => {
  it('pending -> syncing -> synced', () => {
    const s = startSync(cap())
    expect(s.state).toBe('syncing')
    expect(markSynced(s).state).toBe('synced')
  })

  it('a retryable failure waits for its backoff; a permanent one waits for a person', () => {
    const t = 10_000
    const soft = markFailed(startSync(cap()), 'network', true, t)
    expect(soft).toMatchObject({ state: 'failed', attempts: 1, lastError: 'network', nextAttemptAt: t + 2000 })
    expect(isDue(soft, t + 1999)).toBe(false)
    expect(isDue(soft, t + 2000)).toBe(true)
    const hard = markFailed(startSync(cap()), 'http_403', false, t)
    expect(hard.nextAttemptAt).toBeNull()
    expect(isDue(hard, t + 10 ** 9)).toBe(false)
    expect(retryNow(hard)).toMatchObject({ state: 'pending', nextAttemptAt: null, lastError: null, attempts: 1 })
    expect(isDue(retryNow(hard), t)).toBe(true)
  })

  it('failed -> syncing again once due, and attempts keep counting', () => {
    let c = markFailed(startSync(cap()), 'network', true, 0)
    c = markFailed(startSync(c), 'network', true, 5_000)
    expect(c.attempts).toBe(2)
    expect(c.nextAttemptAt).toBe(5_000 + 4000)
  })

  it('a sync interrupted by a reload (or paused for sign-in) returns to pending without a failure', () => {
    const c = markPending(startSync(cap()))
    expect(c).toMatchObject({ state: 'pending', attempts: 0 })
  })

  it('rejects illegal transitions', () => {
    expect(() => markSynced(cap())).toThrow()
    expect(() => markFailed(cap(), 'x', true, 0)).toThrow()
    expect(() => startSync(startSync(cap()))).toThrow()
    expect(() => retryNow(cap())).toThrow()
    expect(() => startSync(markSynced(startSync(cap())))).toThrow()
  })

  it('backoff doubles from 2 s and caps at 5 min', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 32000])
    expect(backoffMs(30)).toBe(300_000)
  })

  it('only pending items, and failed items past their time, are due; syncing and synced never', () => {
    expect(isDue(cap(), 0)).toBe(true)
    expect(isDue(cap({ state: 'syncing' }), 0)).toBe(false)
    expect(isDue(cap({ state: 'synced' }), 0)).toBe(false)
  })
})

describe('response classification', () => {
  it.each([
    [200, null, 'ok'], [201, null, 'ok'],
    [410, 'device_revoked', 'revoked'], [410, 'gone', 'permanent'],
    [401, 'unauthenticated', 'auth'],
    [408, null, 'retry'], [429, null, 'retry'], [500, 'internal', 'retry'], [503, null, 'retry'],
    [400, 'invalid_request', 'permanent'], [403, 'consent_required', 'permanent'], [404, 'not_found', 'permanent'],
    [413, 'too_large', 'permanent'],
  ])('%i %s -> %s', (status, code, expected) => {
    expect(classifyResponse(status, code)).toBe(expected)
  })
})

describe('24 h queue-age alert (FR-OFF-05, E-OFF-04)', () => {
  it('flags unsynced captures at or past 24 h by the device clock', () => {
    const now = 100 * 3600_000
    const cs = [
      cap({ id: 'old', capturedAt: now - QUEUE_ALERT_MS }),
      cap({ id: 'fresh', capturedAt: now - QUEUE_ALERT_MS + 1 }),
      cap({ id: 'done', state: 'synced', capturedAt: 0 }),
      cap({ id: 'oldFailed', state: 'failed', capturedAt: 0 }),
    ]
    expect(overdue(cs, now).map((c) => c.id)).toEqual(['old', 'oldFailed'])
  })
})
