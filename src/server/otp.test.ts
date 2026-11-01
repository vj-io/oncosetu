import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateOtpAttempt, OTP_LOCK_MS, OTP_MAX_ATTEMPTS, otpCodeHash, sendAllowed } from './otp'

beforeAll(() => { process.env.HMAC_KEY = randomBytes(32).toString('base64') })

const t0 = new Date('2026-11-02T10:00:00Z')
const challenge = (over: Partial<Parameters<typeof evaluateOtpAttempt>[0] & object> = {}) => ({
  id: 'c1', codeHash: otpCodeHash('c1', '123456'), attempts: 0, lockedUntil: null as Date | null,
  expiresAt: new Date(t0.getTime() + 5 * 60_000), consumedAt: null as Date | null, ...over,
})

describe('OTP attempts', () => {
  it('accepts the right code once', () => {
    const r = evaluateOtpAttempt(challenge(), '123456', t0)
    expect(r.ok).toBe(true)
    expect(r.update?.consumedAt).toEqual(t0)
    expect(evaluateOtpAttempt(challenge({ consumedAt: t0 }), '123456', t0).ok).toBe(false)
  })
  it('locks for 15 minutes after 5 failures, then even the right code fails', () => {
    let c = challenge()
    for (let i = 1; i <= OTP_MAX_ATTEMPTS; i++) {
      const r = evaluateOtpAttempt(c, '000000', t0)
      expect(r.ok).toBe(false)
      c = { ...c, ...r.update }
      expect(c.attempts).toBe(i)
    }
    expect(c.lockedUntil?.getTime()).toBe(t0.getTime() + OTP_LOCK_MS)
    expect(evaluateOtpAttempt(c, '123456', new Date(t0.getTime() + 60_000)).ok).toBe(false)
  })
  it('rejects expired codes and missing challenges uniformly', () => {
    expect(evaluateOtpAttempt(challenge(), '123456', new Date(t0.getTime() + 5 * 60_000)).ok).toBe(false)
    expect(evaluateOtpAttempt(undefined, '123456', t0)).toEqual({ ok: false })
  })
  it('a code for another challenge does not verify', () => {
    expect(evaluateOtpAttempt(challenge({ id: 'c2' }), '123456', t0).ok).toBe(false)
  })
})

describe('OTP send budget per phone (S3b)', () => {
  const ago = (min: number) => new Date(t0.getTime() - min * 60_000)
  it('allows 3 codes in 10 minutes, then refuses until the oldest ages out', () => {
    expect(sendAllowed([], t0)).toBe(true)
    expect(sendAllowed([ago(1), ago(2)], t0)).toBe(true)
    expect(sendAllowed([ago(1), ago(2), ago(9)], t0)).toBe(false)
    expect(sendAllowed([ago(1), ago(2), ago(10)], t0)).toBe(true)
  })
  it('allows 10 codes in 24 hours', () => {
    const spread = (n: number) => Array.from({ length: n }, (_, i) => ago(15 + i * 60))
    expect(sendAllowed(spread(9), t0)).toBe(true)
    expect(sendAllowed(spread(10), t0)).toBe(false)
    expect(sendAllowed([...spread(9), ago(24 * 60 + 1)], t0)).toBe(true)
  })
})
