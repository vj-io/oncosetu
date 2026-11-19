// Staff navigation and where each role lands after signing in. One list, used by the sign-in page and the staff shell,
// so a role can never be sent to a page it is not allowed to open (org_admin and auditor used to fall through to /desk: 403).
export type StaffRole = 'desk' | 'records' | 'clinician' | 'org_admin' | 'auditor'

export const STAFF_ROLES: readonly StaffRole[] = ['desk', 'records', 'clinician', 'org_admin', 'auditor']

const CLINICAL: StaffRole[] = ['desk', 'records', 'clinician']

// Minimal on purpose: each role sees only the few places it actually works in.
// Desk: front desk, patients, capture. Records: to do, patients, pre-auth files, capture. Clinician: patients only.
// Everything else a role needs sits in the account menu (STAFF_MENU) or inside the pages themselves.
export const STAFF_NAV: { href: string; label: string; roles: StaffRole[] }[] = [
  { href: '/desk', label: 'Front desk', roles: ['desk'] },
  { href: '/records', label: 'To do', roles: ['records'] },
  { href: '/patients', label: 'Patients', roles: CLINICAL },
  { href: '/preauth', label: 'Pre-auth files', roles: ['records'] },
  { href: '/capture', label: 'Capture', roles: ['desk', 'records'] },
  { href: '/admin', label: 'Admin', roles: ['org_admin', 'auditor'] },
]

/** Links in the account menu (top right), after the tour entry and before "Sign out". */
export const STAFF_MENU: { href: string; label: string; roles: StaffRole[] }[] = [
  { href: '/measure', label: 'Study form (1 min)', roles: ['clinician'] },
  { href: '/admin/duplicates', label: 'Duplicate records', roles: ['records'] },
  { href: '/account/sessions', label: 'Where you are signed in', roles: ['desk', 'records', 'clinician', 'org_admin', 'auditor'] },
]

/** Roles that get the "Take the 2-minute tour" entry (the tour is written for the clinician and records views). */
export const TOUR_ROLES: StaffRole[] = ['clinician', 'records']

export function menuFor(role: StaffRole) {
  return STAFF_MENU.filter((n) => n.roles.includes(role))
}

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
