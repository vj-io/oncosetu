// The admin console in five plain groups. Hrefs and who may open what still come from SECTIONS; only the grouping and the plain names live here.
import { SECTIONS, type SectionKey } from '@/server/admin/sections'

export type AdminGroupId = 'people' | 'safety' | 'quality' | 'requests' | 'settings'

export const ADMIN_GROUPS: { id: AdminGroupId; title: string; blurb: string; sections: SectionKey[] }[] = [
  { id: 'people', title: 'People', blurb: 'Who has an account, and which devices can capture papers.', sections: ['staff', 'devices'] },
  { id: 'safety', title: 'Safety and activity', blurb: 'What was blocked or held, emergency access, and the record of who did what.', sections: ['safety', 'breakGlass', 'audit'] },
  { id: 'quality', title: 'Quality', blurb: 'Whether the missing-papers checks and the reading of documents are doing their job.', sections: ['rules', 'metrics', 'measurement'] },
  { id: 'requests', title: 'Data requests', blurb: 'Patients asking to be erased, and patients who may be on file twice.', sections: ['erasure', 'duplicates'] },
  { id: 'settings', title: 'Settings', blurb: 'Switches for this hospital, and how long records are kept.', sections: ['settings'] },
]

/** Plain page names (the shorter SECTIONS labels stay for code that still uses them). */
export const PLAIN_LABEL: Record<SectionKey, string> = {
  overview: 'Overview',
  staff: 'Staff accounts',
  devices: 'Capture devices',
  safety: 'Blocked and held',
  breakGlass: 'Emergency access',
  audit: 'Activity log',
  rules: 'Missing-papers checks',
  metrics: 'How well it works',
  measurement: 'Consultation study',
  erasure: 'Erasure requests',
  duplicates: 'Duplicate patients',
  settings: 'Settings',
}

export type NavGroup = { id: AdminGroupId; title: string; href: string; pages: { href: string; label: string }[] }

/** Only the groups (and pages) this role may open. A group with no page for the role is dropped. */
export function groupsFor(role: string): NavGroup[] {
  return ADMIN_GROUPS.map((g) => {
    const pages = g.sections.filter((k) => (SECTIONS[k].roles as readonly string[]).includes(role)).map((k) => ({ href: SECTIONS[k].href, label: PLAIN_LABEL[k] }))
    return { id: g.id, title: g.title, href: pages[0]?.href ?? '', pages }
  }).filter((g) => g.pages.length > 0)
}

/** Plain role names for people reading the console (never the stored code such as org_admin). */
export const ROLE_LABEL: Record<string, string> = { desk: 'Desk', records: 'Records', clinician: 'Clinician', org_admin: 'Administrator', auditor: 'Auditor', patient: 'Patient', caregiver: 'Family member', system: 'System' }
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? 'Staff member'
