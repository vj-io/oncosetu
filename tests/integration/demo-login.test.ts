// Demo sign-in codes never touch the real OTP limits: five demo codes for a phone leave all three real codes allowed, and the
// demo code verifies only through its own purpose. Needs .env.local.
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

describe('demo OTP vs real OTP', () => {
  it('demo codes do not count against the 3-per-10-minutes limit', async () => {
    const otp = await import('../../src/server/otp')
    const h = randomBytes(16).toString('hex')
    for (let i = 0; i < 5; i++) await otp.startDemoOtp(h)
    expect(await otp.startOtp(h)).not.toBeNull()
    expect(await otp.startOtp(h)).not.toBeNull()
    expect(await otp.startOtp(h)).not.toBeNull()
    expect(await otp.startOtp(h)).toBeNull() // the real limit is unchanged: the 4th real code is refused
  })
  it('a demo code verifies through its own purpose only, once', async () => {
    const otp = await import('../../src/server/otp')
    const h = randomBytes(16).toString('hex')
    const { code } = await otp.startDemoOtp(h)
    expect(await otp.verifyOtp(h, code)).toBe(false) // not a login code
    expect(await otp.verifyOtp(h, code, 'demo_login')).toBe(true)
    expect(await otp.verifyOtp(h, code, 'demo_login')).toBe(false) // used up
  })
})
