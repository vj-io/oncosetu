// Staff navigation and where each role lands after signing in. One list, used by the sign-in page and the staff shell,
// so a role can never be sent to a page it is not allowed to open (org_admin and auditor used to fall through to /desk: 403).
export type StaffRole = 'desk' | 'records' | 'clinician' | 'org_admin' | 'auditor'

export const STAFF_ROLES: readonly StaffRole[] = ['desk', 'records', 'clinician', 'org_admin', 'auditor']

const CLINICAL: StaffRole[] = ['desk', 'records', 'clinician']

export const STAFF_NAV: { href: string; label: string; roles: StaffRole[] }[] = [
  { href: '/desk', label: 'Desk', roles: CLINICAL },
  { href: '/patients', label: 'Patients', roles: CLINICAL },
  { href: '/records', label: 'Records queue', roles: ['records', 'clinician'] },
  { href: '/capture', label: 'Capture', roles: CLINICAL },
  { href: '/measure', label: 'Measure', roles: ['clinician'] },
  { href: '/admin/metrics', label: 'Metrics', roles: ['clinician'] },
  { href: '/admin/duplicates', label: 'Duplicates', roles: ['records'] },
  { href: '/admin', label: 'Admin', roles: ['org_admin', 'auditor'] },
]

/** A clinician starts on Patients and records staff on the records queue; the rest on their first allowed nav item. */
const PREFERRED: Partial<Record<StaffRole, string>> = { clinician: '/patients', records: '/records' }

export function navFor(role: StaffRole) {
  return STAFF_NAV.filter((n) => n.roles.includes(role))
}

/** The page a role lands on after sign-in. Always one of that role's own nav items. Unknown roles go to the sign-in page. */
export function roleHome(role: string | undefined | null): string {
  if (!role || !(STAFF_ROLES as readonly string[]).includes(role)) return '/login'
  const nav = navFor(role as StaffRole)
  const pref = PREFERRED[role as StaffRole]
  return nav.find((n) => n.href === pref)?.href ?? nav[0].href
}
