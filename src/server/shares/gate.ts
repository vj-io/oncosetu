// Share-link open rules (FR-PAS-02, E-PAS-01/02, FR-CON-04). Pure: checked on every use, in this order.
export const MAX_ATTEMPTS = 5

export type LinkState = { revokedAt: Date | null; expiresAt: Date; lockedAt: Date | null; hasPasscode: boolean }

export type Gate =
  | 'gone_revoked' | 'gone_expired' | 'gone_unavailable' // 410, neutral message
  | 'locked' // 423
  | 'passcode_required' // 401, not counted as an attempt
  | 'check_passcode'
  | 'open'

/** `available` = the patient's latest consent still covers sharing and the record is active. */
export function openGate(link: LinkState, now: Date, available: boolean, passcodeGiven: boolean): Gate {
  if (link.revokedAt) return 'gone_revoked'
  if (link.expiresAt <= now) return 'gone_expired'
  if (!available) return 'gone_unavailable'
  if (link.lockedAt) return 'locked'
  if (!link.hasPasscode) return 'open'
  return passcodeGiven ? 'check_passcode' : 'passcode_required'
}

/** After a wrong passcode raised the counter to `attempts`. */
export const afterWrong = (attempts: number) =>
  attempts >= MAX_ATTEMPTS ? { locked: true, left: 0 } : { locked: false, left: MAX_ATTEMPTS - attempts }
