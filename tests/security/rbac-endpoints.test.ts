// PRD §10.2 "RBAC matrix test: every role × every endpoint" — the static half: every API handler has a reviewed entry in
// api-roles.ts and route()'s guard is exactly that entry. tests/e2e/rbac-sweep.spec.ts calls each handler as each role.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXPECTED, policyOf } from './api-roles'
import { SIGNED_IN_ROLES, scanApiRoutes } from './api-routes'

const routes = scanApiRoutes()
const gateOf = (s: string): readonly string[] | 'public' => (s === 'public' ? 'public' : s === 'any' ? SIGNED_IN_ROLES : s.split(' '))
const norm = (x: readonly string[] | 'public') => (x === 'public' ? 'public' : [...x].sort().join(' '))

describe('every API handler has a role entry (tests/security/api-roles.ts)', () => {
  it('the scanner reads the handlers (not an empty sweep)', () => {
    expect(routes.length).toBeGreaterThan(100)
    expect(routes.find((r) => r.key === 'POST /api/patients/[id]/seal')?.allowed).toEqual(['clinician'])
    expect(routes.find((r) => r.key === 'POST /api/inbound/email')?.auth).toBe('custom')
  })

  it('no handler without an entry, no entry without a handler', () => {
    const keys = new Set(routes.map((r) => r.key))
    expect(routes.filter((r) => !(r.key in EXPECTED)).map((r) => `${r.key} (${r.file})`), 'add these to api-roles.ts').toEqual([])
    expect(Object.keys(EXPECTED).filter((k) => !keys.has(k)), 'stale entries in api-roles.ts').toEqual([])
  })

  it("route()'s guard equals the entry; a wider gate is narrowed in the handler", () => {
    const wrong: string[] = []
    for (const r of routes) {
      const e = EXPECTED[r.key]
      if (!e) continue
      const gate = typeof e === 'string' ? policyOf(e) : gateOf(e.gate)
      if (norm(r.allowed) !== norm(gate)) wrong.push(`${r.key}: route() allows ${norm(r.allowed)}, entry says ${norm(gate)}`)
      if (typeof e !== 'string') {
        const policy = policyOf(e)
        if (policy !== 'public' && gate !== 'public' && policy.some((p) => !gate.includes(p))) wrong.push(`${r.key}: policy ${e.roles} is not inside the gate ${e.gate}`)
        if (!readFileSync(e.in ?? r.file, 'utf8').includes(e.check)) wrong.push(`${r.key}: narrowing check not found in ${e.in ?? r.file}: ${e.check}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('every non-public handler names its roles or the full staff / family set on purpose', () => {
    // auth 'staff' without roles would silently admit every staff role, auditor included; only /api/auth/me may do that.
    const open = routes.filter((r) => r.allowed !== 'public' && r.allowed.length === SIGNED_IN_ROLES.length).map((r) => r.key)
    expect(open.filter((k) => typeof EXPECTED[k] === 'string')).toEqual(['GET /api/auth/me'])
  })
})
