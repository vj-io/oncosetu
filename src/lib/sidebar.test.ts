import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { currentItem, patientGroupsFor, patientIdIn, sidebarFor } from './sidebar'
import { tabAllowed } from './patient-tabs'
import { STAFF_ROLES } from './staff-nav'

const ID = '01a1ffb0-0236-73d9-801e-470462b492d1'
const page = (href: string) => existsSync(join(process.cwd(), 'src/app/(staff)', href.replace(/\/patients\/[^/]+/, '/patients/[id]'), 'page.tsx'))

describe('staff sidebar', () => {
  it('every link is a real page, and no page is listed twice for a role (a ?view= sub-page counts once)', () => {
    for (const r of STAFF_ROLES) {
      const items = [...sidebarFor(r), ...patientGroupsFor(ID, r)].flatMap((g) => g.items)
      for (const i of items) expect(page(i.href), `${r} ${i.href}`).toBe(true)
      const keys = items.map((i) => `${i.href}?${i.view ?? ''}`)
      expect(new Set(keys).size, r).toBe(keys.length)
    }
  })
  it('lists only the record sections a role may open', () => {
    for (const r of STAFF_ROLES) for (const i of patientGroupsFor(ID, r).flatMap((g) => g.items)) expect(tabAllowed(i.href.split('/').pop()!, r), `${r} ${i.href}`).toBe(true)
    expect(patientGroupsFor(ID, 'desk').flatMap((g) => g.items).map((i) => i.label)).not.toContain('All records')
  })
  it('gives records staff the to-do lists as their own pages, and administrators the console groups', () => {
    expect(sidebarFor('records')[0].items.filter((i) => i.view).map((i) => i.view)).toEqual(['ask', 'reminders', 'arrived', 'files'])
    expect(sidebarFor('org_admin').map((g) => g.label)).toEqual(['Admin', 'People', 'Safety and activity', 'Quality', 'Data requests', 'Settings', 'Account'])
    expect(sidebarFor('clinician')[0].items.map((i) => i.label)).toEqual(['Patients', 'Study form (1 min)'])
  })
  it('marks exactly one current item: the longest match, or the chosen view', () => {
    const items = sidebarFor('desk').flatMap((g) => g.items)
    expect(currentItem(items, '/patients/new', null)?.label).toBe('Register a patient')
    expect(currentItem(items, '/patients', null)?.label).toBe('Patients')
    const rec = sidebarFor('records').flatMap((g) => g.items)
    expect(currentItem(rec, '/records', 'ask')?.label).toBe('Papers to ask for')
    expect(currentItem(rec, '/records', null)?.label).toBe('To do')
    expect(currentItem(rec, '/records', 'nonsense')?.label).toBe('To do')
  })
  it('finds the patient id only inside a record', () => {
    expect(patientIdIn(`/patients/${ID}/ledger`)).toBe(ID)
    expect(patientIdIn('/patients/new')).toBeNull()
    expect(patientIdIn('/patients')).toBeNull()
  })
})
