import { describe, expect, it } from 'vitest'
import { SECTIONS } from '@/server/admin/sections'
import { ADMIN_GROUPS, groupsFor, PLAIN_LABEL } from './groups'

describe('admin groups', () => {
  it('there are five groups', () => {
    expect(ADMIN_GROUPS).toHaveLength(5)
    expect(groupsFor('org_admin')).toHaveLength(5)
  })
  it('every section except Overview sits in exactly one group, so no page loses its link', () => {
    const all = ADMIN_GROUPS.flatMap((g) => g.sections).sort()
    const expected = Object.keys(SECTIONS).filter((k) => k !== 'overview').sort()
    expect(all).toEqual(expected)
  })
  it('every section has a plain label', () => {
    for (const k of Object.keys(SECTIONS)) expect(PLAIN_LABEL[k as keyof typeof SECTIONS]).toBeTruthy()
  })
  it('a role sees only the pages it may open', () => {
    const pages = groupsFor('auditor').flatMap((g) => g.pages.map((p) => p.href))
    for (const href of pages) {
      const s = Object.values(SECTIONS).find((x) => x.href === href)!
      expect((s.roles as readonly string[]).includes('auditor')).toBe(true)
    }
  })
})
