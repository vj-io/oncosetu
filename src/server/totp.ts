// RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits), ±1 step tolerance.
import { createHmac } from 'node:crypto'
import { base32Decode, base32Encode, randomToken, sha256Hex, timingSafeEqualStr } from './crypto'

export const TOTP_STEP_S = 30

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', key).update(msg).digest()
  const o = h[h.length - 1] & 0xf
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

/** `secret` is base32 (as shown to authenticator apps) or raw key bytes. */
export function totp(secret: string | Buffer, timeMs = Date.now(), digits = 6): string {
  const key = typeof secret === 'string' ? base32Decode(secret) : secret
  return hotp(key, Math.floor(timeMs / 1000 / TOTP_STEP_S), digits)
}

export function verifyTotp(secret: string | Buffer, code: string, timeMs = Date.now()): boolean {
  return totpStep(secret, code, timeMs) !== null
}

/** The time step (counter) the code belongs to within ±1 step, or null. All three steps are always compared. */
export function totpStep(secret: string | Buffer, code: string, timeMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const now = Math.floor(timeMs / 1000 / TOTP_STEP_S)
  let hit: number | null = null
  for (const d of [-1, 0, 1]) if (timingSafeEqualStr(totp(secret, timeMs + d * TOTP_STEP_S * 1000), code)) hit = now + d
  return hit
}

/**
 * The seeded demo and E2E accounts' secret: derived from the email, so anyone with the source can compute its codes, and
 * the demo sign-in panel hands them out. A code from it proves nothing more after its first use, so it is not tracked.
 */
export const demoTotpSecret = (email: string) => base32Encode(Buffer.from(sha256Hex(`oncosetu-demo-totp:${email}`), 'hex').subarray(0, 20))

/** 160-bit base32 secret. */
export function generateTotpSecret(): string {
  return randomToken(20, 'base32')
}

export function totpUri(secret: string, account: string, issuer = 'OncoSetu'): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

/** Seconds until the current code rolls over (for the demo-accounts panel). */
export function totpSecondsRemaining(timeMs = Date.now()): number {
  return TOTP_STEP_S - (Math.floor(timeMs / 1000) % TOTP_STEP_S)
}
