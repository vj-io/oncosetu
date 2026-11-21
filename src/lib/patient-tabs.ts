// Which staff roles can open each patient-workspace tab. Mirrors the requireStaff() role list on each tab page
// (src/app/(staff)/patients/[id]/<tab>/page.tsx); tabs not listed here open for every role that can open the record.
import type { StaffRole } from './staff-nav'

/**
 * Every tab of the patient workspace, in order. Each role sees at most four tabs in the bar (MAIN_FOR, its daily
 * work); every other tab it may open sits under "More". `records` is the All-records view; `documents` is where papers
 * are added and checked.
 */
export const PATIENT_TAB_LIST = [
  { key: 'overview', label: 'Overview' },
  { key: 'records', label: 'All records' },
  { key: 'ledger', label: 'What’s new' },
  { key: 'completeness', label: 'Missing papers' },
  { key: 'documents', label: 'Documents' },
  { key: 'requests', label: 'Requests' },
  { key: 'shares', label: 'Share links' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'preauth', label: 'Pre-auth file' },
  { key: 'statements', label: 'Patient said' },
  { key: 'consent', label: 'Consent & access' },
  { key: 'audit', label: 'Who opened this record' },
  { key: 'card', label: 'Records card' },
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

/** The tab bar for each role: its daily work, at most four tabs. The desk adds papers; records staff and clinicians review them. */
const MAIN_FOR: Record<StaffRole, readonly PatientTabKey[]> = {
  desk: ['overview', 'documents', 'completeness', 'requests'],
  records: ['overview', 'records', 'ledger', 'completeness'],
  clinician: ['overview', 'records', 'ledger', 'completeness'],
  org_admin: ['overview', 'completeness'],
  auditor: ['overview', 'audit'],
}

/** The tabs a role sees, split into the tab bar and the "More" menu (without a role: the clinician's bar). */
export function tabsFor(role: StaffRole | undefined) {
  const visible = PATIENT_TAB_LIST.filter((t) => !role || tabAllowed(t.key, role))
  const bar = MAIN_FOR[role ?? 'clinician']
  const main = bar.flatMap((k) => visible.filter((t) => t.key === k))
  return { main, more: visible.filter((t) => !bar.includes(t.key)) }
}
