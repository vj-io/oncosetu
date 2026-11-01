// Pure queue rules (FR-OFF-02, FR-OFF-05): states, retry backoff, response classification, 24 h age alert.
//   pending -> syncing -> synced (item is then wiped)
//                      -> failed -> (backoff elapsed, or "retry now") -> syncing
//                      -> pending (interrupted by reload, or paused for sign-in)
export type CaptureState = 'pending' | 'syncing' | 'failed' | 'synced'

/** The plaintext part of a queued capture: no patient data, so the queue can be counted and aged while locked. */
export type CaptureMeta = {
  id: string // client UUIDv7
  state: CaptureState
  capturedAt: number // device clock, epoch ms. Sent as clientCapturedAt only; the server clock is authoritative.
  pageCount: number
  attempts: number
  nextAttemptAt: number | null // null on a failed item = needs a person (permanent error)
  lastError: string | null // error code only
  offline: boolean // captured while offline -> intakeRoute 'offline_sync'
}

export const QUEUE_ALERT_MS = 24 * 3600_000
const BACKOFF_BASE_MS = 2000
const BACKOFF_MAX_MS = 5 * 60_000

/** 2 s, 4 s, 8 s ... capped at 5 min. `attempts` = failures so far (>= 1). */
export const backoffMs = (attempts: number) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS)

function must(c: CaptureMeta, from: CaptureState[], to: CaptureState) {
  if (!from.includes(c.state)) throw new Error(`illegal transition ${c.state} -> ${to}`)
}

export const isDue = (c: CaptureMeta, now: number) =>
  c.state === 'pending' || (c.state === 'failed' && c.nextAttemptAt !== null && now >= c.nextAttemptAt)

export function startSync(c: CaptureMeta): CaptureMeta {
  must(c, ['pending', 'failed'], 'syncing')
  return { ...c, state: 'syncing', nextAttemptAt: null }
}
export function markSynced(c: CaptureMeta): CaptureMeta {
  must(c, ['syncing'], 'synced')
  return { ...c, state: 'synced', lastError: null }
}
export function markFailed(c: CaptureMeta, code: string, retryable: boolean, now: number): CaptureMeta {
  must(c, ['syncing'], 'failed')
  const attempts = c.attempts + 1
  return { ...c, state: 'failed', attempts, lastError: code, nextAttemptAt: retryable ? now + backoffMs(attempts) : null }
}
/** Back to waiting without counting a failure: app reloaded mid-sync, or sync paused until sign-in. */
export function markPending(c: CaptureMeta): CaptureMeta {
  must(c, ['syncing'], 'pending')
  return { ...c, state: 'pending' }
}
/** "Retry now" on a failed item. */
export function retryNow(c: CaptureMeta): CaptureMeta {
  must(c, ['failed'], 'pending')
  return { ...c, state: 'pending', nextAttemptAt: null, lastError: null }
}

export type Outcome = 'ok' | 'revoked' | 'auth' | 'retry' | 'permanent'

/** What an upload response means for the queue. 410 device_revoked wipes everything (FR-OFF-06). */
export function classifyResponse(status: number, code: string | null): Outcome {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 410 && code === 'device_revoked') return 'revoked'
  if (status === 401) return 'auth'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry'
  return 'permanent' // 400/403/404/409/413/415/...: retrying the same bytes cannot help
}

/** Unsynced captures that have waited 24 h or more on this device. */
export const overdue = (cs: CaptureMeta[], now: number) =>
  cs.filter((c) => c.state !== 'synced' && now - c.capturedAt >= QUEUE_ALERT_MS)
