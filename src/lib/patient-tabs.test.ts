import { describe, expect, it } from 'vitest'
import { PATIENT_TABS } from '@/components/shell/PatientWorkspaceHeader'
import { rolesSentence, tabAllowed, tabsFor, PATIENT_TAB_LIST, PATIENT_TAB_ROLES } from './patient-tabs'
import { STAFF_ROLES } from './staff-nav'

describe('patient workspace tabs by role', () => {
  it('the timeline is for records staff and clinicians only', () => {
    expect(STAFF_ROLES.filter((r) => tabAllowed('timeline', r))).toEqual(['records', 'clinician'])
  })
  it('every role-limited tab is a real tab, and every role sees at least overview and documents', () => {
    const keys = PATIENT_TABS.map(([k]) => k) as string[]
    for (const k of Object.keys(PATIENT_TAB_ROLES)) expect(keys).toContain(k)
    for (const r of STAFF_ROLES) { expect(tabAllowed('overview', r)).toBe(true); expect(tabAllowed('documents', r)).toBe(true) }
  })
  it('desk staff do not see the timeline or the pre-auth file but do see the ledger, requests and shares', () => {
    expect(tabAllowed('timeline', 'desk')).toBe(false)
    expect(tabAllowed('preauth', 'desk')).toBe(false)
    for (const t of ['ledger', 'requests', 'shares']) expect(tabAllowed(t, 'desk')).toBe(true)
  })
  it('administrators only get the checklist and the pre-auth file among the role-limited tabs', () => {
    expect(PATIENT_TABS.map(([k]) => k).filter((k) => !tabAllowed(k, 'org_admin') ).sort()).toEqual(['ledger', 'requests', 'shares', 'timeline'])
  })
  it('every role gets exactly the six main tabs it may open, in order, and the rest under More', () => {
    const six = ['overview', 'records', 'ledger', 'completeness', 'requests', 'shares']
    expect(PATIENT_TAB_LIST.filter((t) => t.main).map((t) => t.key)).toEqual(six)
    for (const r of STAFF_ROLES) {
      const { main, more } = tabsFor(r)
      expect(main.map((t) => t.key)).toEqual(six.filter((k) => tabAllowed(k, r)))
      expect(more.every((t) => !t.main && tabAllowed(t.key, r))).toBe(true)
      expect([...main, ...more].length).toBe(PATIENT_TAB_LIST.filter((t) => tabAllowed(t.key, r)).length)
    }
    expect(tabsFor('clinician').main).toHaveLength(6)
    expect(tabsFor('org_admin').main.map((t) => t.key)).toEqual(['overview', 'records', 'completeness'])
  })
  it('"records" is labelled All records and nothing is listed twice', () => {
    expect(PATIENT_TAB_LIST.find((t) => t.key === 'records')?.label).toBe('All records')
    const keys = PATIENT_TAB_LIST.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('words the roles in a sentence', () => {
    expect(rolesSentence(['records', 'clinician'])).toBe('clinicians and records staff')
    expect(rolesSentence(['desk'])).toBe('desk staff')
  })
})
