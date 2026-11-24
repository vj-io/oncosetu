// Staff sign-in on the neutral patient address carries no product name (FR-CON-07); the staff address keeps it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const req = vi.hoisted(() => ({ headers: {} as Record<string, string> }))
vi.mock('next/headers', () => ({ headers: async () => new Headers(req.headers) }))
import LoginLayout, { generateMetadata } from './layout'

const brand = async () => (await LoginLayout({ children: null })).props.brand

describe('staff sign-in brand', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_PATIENT_ORIGIN', 'https://setu-records.vercel.app'))
  afterEach(() => vi.unstubAllEnvs())

  it('says Setu Records on the neutral patient address, by Host or by X-Forwarded-Host', async () => {
    const cases: Record<string, string>[] = [{ host: 'setu-records.vercel.app' }, { host: 'internal.vercel', 'x-forwarded-host': 'setu-records.vercel.app' }]
    for (const h of cases) {
      req.headers = h
      expect((await generateMetadata()).title).toBe('Setu Records')
      expect(await brand()).toBe('Setu Records')
    }
  })
  it('keeps OncoSetu on the staff address and when no neutral address is set', async () => {
    req.headers = { host: 'oncosetu-pilot.vercel.app' }
    expect(await generateMetadata()).toEqual({})
    expect(await brand()).toBe('OncoSetu')
    vi.stubEnv('NEXT_PUBLIC_PATIENT_ORIGIN', '')
    req.headers = { host: 'setu-records.vercel.app' }
    expect(await brand()).toBe('OncoSetu')
  })
  it('says the records are made up only on the demo (DEMO_MODE), never on the pilot', async () => {
    req.headers = { host: 'oncosetu-pilot.vercel.app' }
    const demo = async () => (await LoginLayout({ children: null })).props.demo
    vi.stubEnv('DEMO_MODE', 'true')
    expect(await demo()).toBe(true)
    for (const off of ['false', '']) {
      vi.stubEnv('DEMO_MODE', off)
      expect(await demo()).toBe(false)
    }
  })
})
