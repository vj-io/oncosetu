// RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits), ±1 step tolerance.
import { createHmac } from 'node:crypto'
import { base32Decode, randomToken, timingSafeEqualStr } from './crypto'

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
  if (!/^\d{6}$/.test(code)) return false
  let ok = false
  for (const d of [-1, 0, 1]) ok = timingSafeEqualStr(totp(secret, timeMs + d * TOTP_STEP_S * 1000), code) || ok
  return ok
}

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
