// RFC 6238 codes for the seeded E2E staff: same deterministic secret formula as scripts/seed-base.ts (demoTotpSecret).
import { base32Encode, sha256Hex } from '../../../src/server/crypto'
import { totp } from '../../../src/server/totp'

export const secretFor = (email: string) => base32Encode(Buffer.from(sha256Hex(`oncosetu-demo-totp:${email}`), 'hex').subarray(0, 20))
export const totpFor = (email: string, timeMs = Date.now()) => totp(secretFor(email), timeMs)
/** A well-formed code that is outside the ±1 step window of the real one. */
export const wrongTotpFor = (email: string) => {
  const right = new Set([-1, 0, 1].map((d) => totpFor(email, Date.now() + d * 30_000)))
  for (let n = 0; n < 1_000_000; n += 7919) { const c = String(n).padStart(6, '0'); if (!right.has(c)) return c }
  throw new Error('unreachable')
}
