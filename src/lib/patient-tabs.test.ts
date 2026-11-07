import { describe, expect, it } from 'vitest'
import { PATIENT_TABS } from '@/components/shell/PatientWorkspaceHeader'
import { rolesSentence, tabAllowed, PATIENT_TAB_ROLES } from './patient-tabs'
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
  it('desk staff do not see the timeline but do see the ledger, requests and shares', () => {
    expect(tabAllowed('timeline', 'desk')).toBe(false)
    for (const t of ['ledger', 'requests', 'shares']) expect(tabAllowed(t, 'desk')).toBe(true)
  })
  it('administrators only get the checklist among the role-limited tabs', () => {
    expect(PATIENT_TABS.map(([k]) => k).filter((k) => !tabAllowed(k, 'org_admin') ).sort()).toEqual(['ledger', 'requests', 'shares', 'timeline'])
  })
  it('words the roles in a sentence', () => {
    expect(rolesSentence(['records', 'clinician'])).toBe('clinicians and records staff')
    expect(rolesSentence(['desk'])).toBe('desk staff')
  })
})
