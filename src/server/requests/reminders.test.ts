import { describe, expect, it } from 'vitest'
import { reminderPlan, type TrackedRequest } from './reminders'

const sent = new Date('2026-10-01T06:30:00Z')
const day = (n: number) => new Date(+sent + n * 86_400_000)
const req = (over: Partial<TrackedRequest> = {}): TrackedRequest =>
  ({ state: 'sent', sentAt: sent, fulfilledAt: null, reminder7SentAt: null, reminder21SentAt: null, ...over })

describe('request tracking (FR-REQ-03/04, E-REQ-01)', () => {
  it('drafted stays drafted; sent → reminder_due at +7 d → open_21d at +21 d', () => {
    expect(reminderPlan(req({ state: 'drafted', sentAt: null }), day(30)).state).toBe('drafted')
    expect(reminderPlan(req(), day(6.9)).state).toBe('sent')
    expect(reminderPlan(req(), day(7))).toEqual({ state: 'reminder_due', stamp7: true, stamp21: false, send: 'reminder7' })
    expect(reminderPlan(req({ reminder7SentAt: day(7) }), day(21))).toEqual({ state: 'open_21d', stamp7: false, stamp21: true, send: 'reminder21' })
  })

  it('is idempotent: once stamped, nothing more is sent', () => {
    expect(reminderPlan(req({ reminder7SentAt: day(7) }), day(10))).toEqual({ state: 'reminder_due', stamp7: false, stamp21: false, send: null })
    expect(reminderPlan(req({ reminder7SentAt: day(7), reminder21SentAt: day(21) }), day(40)).send).toBeNull()
  })

  it('crossing both thresholds at once sends ONE reminder (the day-21 one) and stamps both', () => {
    expect(reminderPlan(req(), day(25))).toEqual({ state: 'open_21d', stamp7: true, stamp21: true, send: 'reminder21' })
  })

  it('terminal states never remind', () => {
    for (const state of ['fulfilled', 'unobtainable', 'withdrawn'] as const) {
      expect(reminderPlan(req({ state }), day(30))).toEqual({ state, stamp7: false, stamp21: false, send: null })
    }
  })
})
