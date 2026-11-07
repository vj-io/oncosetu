// Which staff roles can open each patient-workspace tab. Mirrors the requireStaff() role list on each tab page
// (src/app/(staff)/patients/[id]/<tab>/page.tsx); tabs not listed here open for every role that can open the record.
import type { StaffRole } from './staff-nav'

export const PATIENT_TAB_ROLES = {
  timeline: ['records', 'clinician'],
  ledger: ['desk', 'records', 'clinician'],
  completeness: ['desk', 'records', 'clinician', 'org_admin'],
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
