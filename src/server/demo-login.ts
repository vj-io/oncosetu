// Demo sign-in buttons on /p/login. Only when DEMO_MODE is on AND the phone is one of the seeded demo phones. The one-time code
// still has to be entered and "Sign in" pressed, so the OTP step stays visible. Demo codes do not count toward the real
// "3 codes per phone in 10 minutes" limit (they use their own purpose); instead each IP gets 20 per 10 minutes.
import { phoneHmac } from './crypto'
import { isDemo } from './demo'

/** The seeded synthetic people (scripts/seed-demo.ts, public/demo-docs/patients.json). Names and phones are fictional. */
export const DEMO_PEOPLE = [
  { key: 'rohan', name: 'Rohan Deshmukh', phone: '+91 98230 55102', lang: 'hi' as const },
  { key: 'khan', name: 'Mohd. Abdul Rahim Khan', phone: '+91 99870 12345', lang: 'en' as const },
  { key: 'narayanan', name: 'K. Narayanan', phone: '+91 94440 67890', lang: 'en' as const },
  { key: 'pooja', name: 'Pooja Kulkarni', phone: '+91 98500 11223', lang: 'en' as const },
] as const

export const DEMO_IP_LIMIT = { windowMs: 10 * 60_000, max: 20 }
export const DEMO_CODE_TTL_MS = 3 * 60_000
export const DEMO_PURPOSE = 'demo_login'

export const isDemoPhone = (raw: string): boolean => {
  const h = phoneHmac(raw)
  return !!h && DEMO_PEOPLE.some((p) => phoneHmac(p.phone) === h)
}

export type DemoStore = Map<string, number[]>
const defaultStore: DemoStore = new Map()

/** Sliding window per IP. Best effort across serverless instances (each keeps its own window). */
export function allowDemoIp(ip: string, now = Date.now(), store: DemoStore = defaultStore): boolean {
  const recent = (store.get(ip) ?? []).filter((t) => now - t < DEMO_IP_LIMIT.windowMs)
  if (recent.length >= DEMO_IP_LIMIT.max) { store.set(ip, recent); return false }
  store.set(ip, [...recent, now])
  return true
}

export type DemoDecision = { ok: true } | { ok: false; status: 404 | 403 | 429; code: 'not_found' | 'not_demo_phone' | 'rate_limited' }

/** The whole policy in one place: demo mode on, a seeded demo phone, and the per-IP budget. */
export function decideDemoCode(a: { demo?: boolean; phone: string; ip: string; now?: number; store?: DemoStore }): DemoDecision {
  if (!(a.demo ?? isDemo())) return { ok: false, status: 404, code: 'not_found' } // looks exactly like a route that does not exist
  if (!isDemoPhone(a.phone)) return { ok: false, status: 403, code: 'not_demo_phone' }
  if (!allowDemoIp(a.ip, a.now, a.store)) return { ok: false, status: 429, code: 'rate_limited' }
  return { ok: true }
}
