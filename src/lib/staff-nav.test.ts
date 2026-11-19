import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { menuFor, navFor, roleHome, STAFF_MENU, STAFF_NAV, STAFF_ROLES, TOUR_ROLES } from './staff-nav'

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
  it('each role sees a minimal nav', () => {
    const labels = (r: Parameters<typeof navFor>[0]) => navFor(r).map((n) => n.label)
    expect(labels('desk')).toEqual(['Front desk', 'Patients', 'Capture'])
    expect(labels('records')).toEqual(['To do', 'Patients', 'Pre-auth files', 'Capture'])
    expect(labels('clinician')).toEqual(['Patients'])
    expect(labels('org_admin')).toEqual(['Admin'])
    expect(labels('auditor')).toEqual(['Admin'])
  })
  it('the study form is in the clinician menu only, and there is one tour entry', () => {
    expect(menuFor('clinician').map((m) => m.href)).toContain('/measure')
    for (const r of STAFF_ROLES.filter((x) => x !== 'clinician')) expect(menuFor(r).map((m) => m.href)).not.toContain('/measure')
    expect(TOUR_ROLES).toEqual(['clinician', 'records'])
  })
  it('every nav and menu link points at a real page and none is listed twice for a role', () => {
    const page = (href: string) => existsSync(join(process.cwd(), 'src/app/(staff)', href, 'page.tsx'))
    for (const n of [...STAFF_NAV, ...STAFF_MENU]) expect(page(n.href), n.href).toBe(true)
    for (const r of STAFF_ROLES) {
      const hrefs = [...navFor(r), ...menuFor(r)].map((n) => n.href)
      expect(new Set(hrefs).size).toBe(hrefs.length)
    }
  })
})
