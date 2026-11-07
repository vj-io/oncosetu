import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => { process.env.HMAC_KEY = Buffer.alloc(32, 7).toString('base64') }) // phone numbers are matched by their blind index
import { DEMO_IP_LIMIT, DEMO_PEOPLE, allowDemoIp, decideDemoCode, isDemoPhone } from './demo-login'

const base = { phone: '+91 98230 55102', ip: '1.2.3.4' }

describe('demo sign-in policy', () => {
  it('is refused as not found when demo mode is off, whatever the phone', () => {
    expect(decideDemoCode({ ...base, demo: false, store: new Map() })).toEqual({ ok: false, status: 404, code: 'not_found' })
  })
  it('is refused for any phone that is not one of the four seeded demo phones', () => {
    expect(decideDemoCode({ ...base, phone: '+91 90000 00001', demo: true, store: new Map() })).toEqual({ ok: false, status: 403, code: 'not_demo_phone' })
    expect(isDemoPhone('+91 98220 41736')).toBe(false) // Sunita's own phone is not a demo button
  })
  it('accepts each seeded phone, in any spelling of the number', () => {
    for (const p of DEMO_PEOPLE) expect(decideDemoCode({ phone: p.phone, ip: 'x', demo: true, store: new Map() })).toEqual({ ok: true })
    expect(isDemoPhone('9823055102')).toBe(true)
    expect(isDemoPhone('+919823055102')).toBe(true)
  })
  it('limits each IP to 20 in 10 minutes, then lets it back in; other IPs are not affected', () => {
    const store = new Map<string, number[]>(), t0 = 1_000_000
    for (let i = 0; i < DEMO_IP_LIMIT.max; i++) expect(allowDemoIp('a', t0 + i, store)).toBe(true)
    expect(allowDemoIp('a', t0 + 1000, store)).toBe(false)
    expect(allowDemoIp('b', t0 + 1000, store)).toBe(true)
    expect(allowDemoIp('a', t0 + DEMO_IP_LIMIT.windowMs + 100, store)).toBe(true)
  })
  it('the list of demo people matches the seed (names, phones, languages)', () => {
    expect(DEMO_PEOPLE.map((p) => [p.name, p.phone, p.lang])).toEqual([
      ['Rohan Deshmukh', '+91 98230 55102', 'hi'], ['Mohd. Abdul Rahim Khan', '+91 99870 12345', 'en'],
      ['K. Narayanan', '+91 94440 67890', 'en'], ['Pooja Kulkarni', '+91 98500 11223', 'en'],
    ])
  })
})
