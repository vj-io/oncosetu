// Which staff roles can open each patient-workspace tab. Mirrors the requireStaff() role list on each tab page
// (src/app/(staff)/patients/[id]/<tab>/page.tsx); tabs not listed here open for every role that can open the record.
import type { StaffRole } from './staff-nav'

/**
 * Every tab of the patient workspace, in order. `main` tabs sit in the tab bar; the rest sit under "More".
 * `records` is the All-records view (route /patients/[id]/records, built in the doctor-views package); `documents` stays
 * under More until that view replaces it.
 */
export const PATIENT_TAB_LIST = [
  { key: 'overview', label: 'Overview', main: true },
  { key: 'records', label: 'All records', main: true },
  { key: 'ledger', label: 'What’s new', main: true },
  { key: 'completeness', label: 'Missing papers', main: true },
  { key: 'requests', label: 'Requests', main: true },
  { key: 'shares', label: 'Share links', main: true },
  { key: 'documents', label: 'Documents', main: false },
  { key: 'timeline', label: 'Timeline', main: false },
  { key: 'preauth', label: 'Pre-auth file', main: false },
  { key: 'statements', label: 'Patient said', main: false },
  { key: 'consent', label: 'Consent & access', main: false },
  { key: 'audit', label: 'Who opened this record', main: false },
  { key: 'card', label: 'Records card', main: false },
] as const

export type PatientTabKey = (typeof PATIENT_TAB_LIST)[number]['key']

// `records` shows a one-line summary of what each paper says (as written), which is clinical content, so the desk never sees the tab.
export const PATIENT_TAB_ROLES = {
  records: ['records', 'clinician'],
  timeline: ['records', 'clinician'],
  ledger: ['desk', 'records', 'clinician'],
  completeness: ['desk', 'records', 'clinician', 'org_admin'],
  preauth: ['records', 'clinician', 'org_admin'],
  requests: ['desk', 'records', 'clinician'],
  shares: ['desk', 'records', 'clinician'],
} as const satisfies Partial<Record<string, readonly StaffRole[]>>

export function tabAllowed(tab: string, role: StaffRole): boolean {
  const roles = (PATIENT_TAB_ROLES as Record<string, readonly StaffRole[]>)[tab]
  return !roles || roles.includes(role)
}

const WHO: Record<StaffRole, string> = { desk: 'desk staff', records: 'records staff', clinician: 'clinicians', org_admin: 'administrators', auditor: 'auditors' }

/** "clinicians and records staff": used in the friendly "this page is for ..." notice. */
export function rolesSentence(roles: readonly StaffRole[]): string {
  const names = [...roles].reverse().map((r) => WHO[r])
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The tabs a role sees, split into the tab bar and the "More" menu. */
export function tabsFor(role: StaffRole | undefined) {
  const visible = PATIENT_TAB_LIST.filter((t) => !role || tabAllowed(t.key, role))
  return { main: visible.filter((t) => t.main), more: visible.filter((t) => !t.main) }
}
