// WhatsApp hold state machine (FR-ING-05: "matched by registered phone + OTP"). Pure: the DB side is whatsapp.ts.
// A hold is created by the first media message, extended by more media from the same sender, released by the right
// 6-digit code within 10 minutes, discarded after 5 wrong codes or when it expires.
import { hmac, timingSafeEqualStr } from '../crypto'

export const HOLD_TTL_MS = 10 * 60_000
export const HOLD_MAX_ATTEMPTS = 5
/** Files per hold and per email; the per-file limit is the pipeline's MAX_FILE_BYTES (4 MB). */
export const MAX_FILES = 10

export const holdCodeHash = (holdId: string, code: string) => hmac(`inbound-hold:${holdId}:${code}`)

export type HoldState = { id: string; codeHash: string | null; attempts: number; expiresAt: Date; releasedAt: Date | null }
export type HoldDecision =
  | { kind: 'none' } // no open hold: nothing is waiting for a code
  | { kind: 'expired' } // discard; the files are deleted
  | { kind: 'release' }
  | { kind: 'wrong'; attempts: number; left: number }
  | { kind: 'discard'; attempts: number } // the last allowed attempt was wrong

/** A text reply `code` against the sender's open hold. */
export function evaluateHoldReply(h: HoldState | undefined, code: string, now: Date): HoldDecision {
  if (!h || h.releasedAt || !h.codeHash) return { kind: 'none' }
  if (h.expiresAt <= now) return { kind: 'expired' }
  if (/^\d{6}$/.test(code) && timingSafeEqualStr(holdCodeHash(h.id, code), h.codeHash)) return { kind: 'release' }
  const attempts = h.attempts + 1
  return attempts >= HOLD_MAX_ATTEMPTS ? { kind: 'discard', attempts } : { kind: 'wrong', attempts, left: HOLD_MAX_ATTEMPTS - attempts }
}

/** A message body that is a code attempt: six digits, spaces allowed ("482 915"). */
export function codeIn(body: string): string | null {
  const c = body.replace(/\s/g, '')
  return /^\d{6}$/.test(c) ? c : null
}
