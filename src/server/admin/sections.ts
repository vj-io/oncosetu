// Admin console sections and who may open each (PRD §6.1). Pages call requireStaff(SECTIONS.x.roles); the layout filters the nav.
import type { StaffRole } from '../rbac'

export const SECTIONS = {
  overview: { href: '/admin', label: 'Overview', roles: ['org_admin', 'auditor'] },
  staff: { href: '/admin/staff', label: 'Staff', roles: ['org_admin'] },
  rules: { href: '/admin/rules', label: 'Rule library', roles: ['org_admin'] },
  audit: { href: '/admin/audit', label: 'Activity log', roles: ['org_admin', 'auditor'] },
  safety: { href: '/admin/safety', label: 'Blocked and held', roles: ['org_admin', 'auditor'] },
  metrics: { href: '/admin/metrics', label: 'Metrics', roles: ['org_admin', 'auditor', 'clinician'] },
  measurement: { href: '/admin/measurement', label: 'Measurement study', roles: ['org_admin', 'auditor', 'clinician'] },
  devices: { href: '/admin/devices', label: 'Devices', roles: ['org_admin'] },
  erasure: { href: '/admin/erasure', label: 'Erasure requests', roles: ['org_admin'] },
  duplicates: { href: '/admin/duplicates', label: 'Duplicates', roles: ['org_admin', 'records'] },
  breakGlass: { href: '/admin/break-glass', label: 'Break-glass', roles: ['org_admin', 'auditor'] },
  settings: { href: '/admin/settings', label: 'Settings', roles: ['org_admin'] },
} as const satisfies Record<string, { href: string; label: string; roles: readonly StaffRole[] }>

export type SectionKey = keyof typeof SECTIONS
export const sectionRoles = (k: SectionKey): readonly StaffRole[] => SECTIONS[k].roles
