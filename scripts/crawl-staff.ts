/**
 * Opens every staff page once per role against a running server and reports any status of 500 or more.
 *   PORT=3300 npx tsx --env-file=.env.local scripts/crawl-staff.ts
 * Local only: needs the seeded demo accounts (scripts/seed-base.ts). Read-only: it only GETs pages after signing in.
 */
import { totpFor } from '../tests/e2e/helpers/totp'

const BASE = `http://localhost:${process.env.PORT ?? 3300}`
const ROLES = { clinician: 'clinician@narmada.demo', records: 'records@narmada.demo', desk: 'desk@narmada.demo', admin: 'admin@narmada.demo', auditor: 'auditor@narmada.demo' } as const
type Role = keyof typeof ROLES

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/staff/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password: 'Demo@2026', totp: totpFor(email) }),
  })
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${await res.text()}`)
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}

const results: { role: Role; path: string; status: number }[] = []
async function visit(role: Role, cookie: string, path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' })
  await res.text()
  results.push({ role, path, status: res.status })
}

async function main() {
  const cookies = {} as Record<Role, string>
  for (const r of Object.keys(ROLES) as Role[]) cookies[r] = await login(ROLES[r])
  const find = async (q: string) => {
    const res = await fetch(`${BASE}/api/patients?q=${encodeURIComponent(q)}`, { headers: { cookie: cookies.clinician } })
    return ((await res.json()) as { patients: { id: string }[] }).patients[0]?.id
  }
  const ids = (await Promise.all(['Sunita', 'Khan', 'Lakshmi', 'Aarav'].map(find))).filter((x): x is string => !!x)
  const tabs = ['overview', 'documents', 'timeline', 'ledger', 'completeness', 'requests', 'shares', 'statements', 'consent', 'audit', 'card']
  const patientPages = ids.flatMap((id) => tabs.map((t) => `/patients/${id}/${t}`))
  const common = ['/', '/security', '/login', '/patients', '/patients/new', '/desk', '/capture', '/records', '/measure']
  const admin = ['/admin', '/admin/staff', '/admin/rules', '/admin/audit', '/admin/safety', '/admin/metrics', '/admin/measurement', '/admin/devices', '/admin/erasure', '/admin/duplicates', '/admin/break-glass', '/admin/settings']
  for (const role of Object.keys(ROLES) as Role[]) {
    const paths = role === 'admin' || role === 'auditor' ? [...common, ...admin, ...patientPages.slice(0, 3)] : role === 'clinician' ? [...common, ...patientPages, ...admin] : [...common, ...patientPages.slice(0, tabs.length), ...admin.slice(0, 3)]
    for (const p of paths) await visit(role, cookies[role], p)
  }
  const bad = results.filter((r) => r.status >= 500)
  const by = results.reduce<Record<number, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})
  console.log(`pages opened: ${results.length}`, JSON.stringify(by))
  for (const r of results.filter((x) => x.status === 403 && x.role === 'clinician')) console.log(`clinician refused (expected for admin pages): ${r.path}`)
  for (const b of bad) console.log(`FAIL ${b.status} ${b.role} ${b.path}`)
  process.exitCode = bad.length ? 1 : 0
}
main().catch((e) => { console.error(e); process.exit(1) })
