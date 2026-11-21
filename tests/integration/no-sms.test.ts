// Without an SMS provider (and outside the demo) a patient's sign-in code would never arrive: the code endpoint says so,
// the same answer for every phone (it reveals nothing about which numbers are registered). Called through the route itself.
import { existsSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { afterAll, describe, expect, it, vi } from 'vitest'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
afterAll(async () => { vi.unstubAllEnvs(); await (await import('../../src/db')).closeDb() })

describe('patient sign-in by phone without SMS', () => {
  it('the code request is refused with 503 sms_unavailable, for a known and an unknown number alike; the demo still answers 200', async () => {
    const { POST } = await import('../../src/app/api/auth/patient/otp/start/route')
    const ask = (phone: string) => POST(new NextRequest('http://localhost/api/auth/patient/otp/start', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' }, body: JSON.stringify({ phone }),
    }), { params: Promise.resolve({}) })
    vi.stubEnv('TWILIO_ACCOUNT_SID', ''); vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    vi.stubEnv('DEMO_MODE', '')
    for (const phone of ['+91 98220 41736', '+91 90000 00001']) {
      const r = await ask(phone)
      expect(r.status).toBe(503)
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('sms_unavailable')
    }
    vi.stubEnv('DEMO_MODE', 'true')
    expect((await ask('+91 90000 00001')).status).toBe(200)
  })
})
