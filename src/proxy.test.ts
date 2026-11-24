// The deployed-host half of the CSP check (tests/e2e/security-headers.spec.ts can only see a localhost server).
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxy } from './proxy'

const csp = (url: string) => proxy(new NextRequest(url)).headers.get('content-security-policy') ?? ''

describe('proxy CSP', () => {
  it('a deployed host gets upgrade-insecure-requests and a nonce + strict-dynamic script policy', () => {
    const c = csp('https://oncosetu-zeta.vercel.app/login')
    expect(c).toContain('upgrade-insecure-requests')
    const script = c.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '))
    expect(script).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'$/) // no unsafe-inline, no unsafe-eval
  })
  it('a plain-http local server does not upgrade its own requests', () => {
    for (const h of ['http://localhost:3100/login', 'http://127.0.0.1:3100/login']) expect(csp(h)).not.toContain('upgrade-insecure-requests')
  })
})

describe('proxy on the neutral patient address', () => {
  afterEach(() => vi.unstubAllEnvs())
  const to = (url: string) => proxy(new NextRequest(url)).headers.get('location')

  it('sends the bare neutral address to patient sign-in, keeping the language', () => {
    vi.stubEnv('NEXT_PUBLIC_PATIENT_ORIGIN', 'https://setu-records.vercel.app')
    expect(to('https://setu-records.vercel.app/')).toBe('https://setu-records.vercel.app/p/login')
    expect(to('https://setu-records.vercel.app/?lang=hi')).toBe('https://setu-records.vercel.app/p/login?lang=hi')
  })
  it('leaves the staff address, other neutral paths and an unset address alone', () => {
    vi.stubEnv('NEXT_PUBLIC_PATIENT_ORIGIN', 'https://setu-records.vercel.app')
    for (const u of ['https://oncosetu-pilot.vercel.app/', 'https://setu-records.vercel.app/p/login', 'https://setu-records.vercel.app/s/abc']) expect(to(u)).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_PATIENT_ORIGIN', '')
    expect(to('https://setu-records.vercel.app/')).toBeNull()
  })
})
