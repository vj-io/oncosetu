import { describe, expect, it } from 'vitest'
import { navFor, roleHome, STAFF_NAV, STAFF_ROLES } from './staff-nav'

describe('roleHome', () => {
  it('sends every role to its own landing page', () => {
    expect(roleHome('desk')).toBe('/desk')
    expect(roleHome('records')).toBe('/records')
    expect(roleHome('clinician')).toBe('/patients')
    expect(roleHome('org_admin')).toBe('/admin')
    expect(roleHome('auditor')).toBe('/admin')
  })
  it('never lands a role on a page outside its own nav', () => {
    for (const r of STAFF_ROLES) expect(navFor(r).map((n) => n.href)).toContain(roleHome(r))
  })
  it('every role has at least one nav item', () => {
    for (const r of STAFF_ROLES) expect(navFor(r).length).toBeGreaterThan(0)
    expect(STAFF_NAV.length).toBeGreaterThan(0)
  })
  it('unknown or missing roles go back to sign-in, not the desk', () => {
    expect(roleHome(undefined)).toBe('/login')
    expect(roleHome('patient')).toBe('/login')
  })
})
