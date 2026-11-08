import { describe, expect, it } from 'vitest'
import { base32Encode } from './crypto'
import { demoTotpSecret, generateTotpSecret, hotp, totp, totpStep, verifyTotp } from './totp'

const KEY = Buffer.from('12345678901234567890') // RFC 4226 / RFC 6238 SHA-1 test key

describe('HOTP (RFC 4226 Appendix D)', () => {
  it('matches all ten vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
    expected.forEach((code, counter) => expect(hotp(KEY, counter)).toBe(code))
  })
})

describe('TOTP (RFC 6238 Appendix B, SHA-1)', () => {
  it.each([
    [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
    [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130'],
  ])('T=%i → %s', (t, code) => {
    expect(totp(KEY, t * 1000, 8)).toBe(code)
    expect(totp(base32Encode(KEY), t * 1000, 8)).toBe(code) // base32 secret path
  })
})

describe('verifyTotp', () => {
  const secret = generateTotpSecret()
  const t = 1_800_000_000_000
  it('accepts the current step and ±1 step', () => {
    expect(verifyTotp(secret, totp(secret, t), t)).toBe(true)
    expect(verifyTotp(secret, totp(secret, t - 30_000), t)).toBe(true)
    expect(verifyTotp(secret, totp(secret, t + 30_000), t)).toBe(true)
  })
  it('rejects ±2 steps and malformed codes', () => {
    expect(verifyTotp(secret, totp(secret, t - 60_000), t)).toBe(false)
    expect(verifyTotp(secret, totp(secret, t + 60_000), t)).toBe(false)
    expect(verifyTotp(secret, '12345', t)).toBe(false)
    expect(verifyTotp(secret, 'abcdef', t)).toBe(false)
  })
  it('names the step a code belongs to, so the login can accept each code once (ASVS 2.8.4)', () => {
    const now = Math.floor(t / 30_000)
    expect(totpStep(secret, totp(secret, t), t)).toBe(now)
    expect(totpStep(secret, totp(secret, t - 30_000), t)).toBe(now - 1)
    expect(totpStep(secret, totp(secret, t + 30_000), t)).toBe(now + 1)
    expect(totpStep(secret, totp(secret, t + 60_000), t)).toBeNull()
  })
  it('derives one public demo secret per email (the seed and the E2E helper use this function)', () => {
    expect(demoTotpSecret('desk@ganga.test')).toMatch(/^[A-Z2-7]{32}$/)
    expect(demoTotpSecret('desk@ganga.test')).not.toBe(demoTotpSecret('records@ganga.test'))
  })
})
