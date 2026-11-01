// Request tracking (FR-REQ-03/04, E-REQ-01): the state a request is in now, and which ONE reminder (if any) is due.
import { requestState } from '@/core/ledger'
import type { RequestState } from '@/core/types'

export type TrackedRequest = {
  state: RequestState; sentAt: Date | null; fulfilledAt: Date | null; reminder7SentAt: Date | null; reminder21SentAt: Date | null
}

export type ReminderPlan = { state: RequestState; stamp7: boolean; stamp21: boolean; send: 'reminder7' | 'reminder21' | null }

const TERMINAL: RequestState[] = ['fulfilled', 'unobtainable', 'withdrawn']

/**
 * State from the (demo-aware) clock; a threshold reached for the first time stamps its column. If both are reached at
 * once (a request recorded weeks late) both are stamped but only the day-21 message goes out: one reminder, not two.
 */
export function reminderPlan(r: TrackedRequest, now: Date): ReminderPlan {
  if (TERMINAL.includes(r.state) || !r.sentAt) return { state: r.sentAt || TERMINAL.includes(r.state) ? r.state : 'drafted', stamp7: false, stamp21: false, send: null }
  const state = requestState(r.sentAt.toISOString(), now.toISOString(), r.fulfilledAt?.toISOString() ?? null)
  const stamp21 = state === 'open_21d' && !r.reminder21SentAt
  const stamp7 = (state === 'reminder_due' || state === 'open_21d') && !r.reminder7SentAt
  return { state, stamp7, stamp21, send: stamp21 ? 'reminder21' : stamp7 ? 'reminder7' : null }
}
