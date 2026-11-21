// The staff sidebar: each role's pages in plain groups, the account pages, and, inside a patient's record, that record's
// sections. Pure data (no React), so it can be tested. Who may open what still comes from the pages' own role checks
// (staff-nav, patient-tabs, admin SECTIONS); this file only arranges links the role can already open.
import { groupsFor } from '@/components/admin/groups'
import { SECTIONS } from '@/server/admin/sections'
import { tabAllowed, type PatientTabKey } from './patient-tabs'
import { menuFor, navFor, type StaffRole } from './staff-nav'

/** `view` marks a sub-page of the same route, chosen by `?view=` (the records to-do lists). */
export type SideItem = { href: string; label: string; icon: string; view?: string; sub?: boolean }
export type SideGroup = { label: string; items: SideItem[] }

/** The records to-do page and its lists, each its own page. */
export const TODO_VIEWS = [
  { view: 'ask', label: 'Papers to ask for', icon: 'mail' },
  { view: 'reminders', label: 'Letter reminders', icon: 'send' },
  { view: 'arrived', label: 'Arrived to confirm', icon: 'package-check' },
  { view: 'files', label: 'Files to check', icon: 'file-search' },
] as const
export type TodoView = (typeof TODO_VIEWS)[number]['view']

const ICON_FOR: Record<string, string> = {
  '/desk': 'clipboard-check', '/records': 'list-checks', '/patients': 'users', '/preauth': 'folder-check', '/capture': 'scan-line',
  '/admin': 'layout-dashboard', '/patients/new': 'user-plus', '/measure': 'clipboard-list', '/admin/duplicates': 'copy',
  '/account/password': 'key-round', '/account/sessions': 'monitor-smartphone',
}

/** The groups a role sees in the sidebar, outside a patient's record. */
export function sidebarFor(role: StaffRole): SideGroup[] {
  const work: SideItem[] = []
  for (const n of navFor(role)) {
    if (n.href === '/admin') continue // the admin console is laid out by its own groups below
    work.push({ href: n.href, label: n.label, icon: ICON_FOR[n.href] ?? 'circle' })
    if (n.href === '/desk') work.push({ href: '/patients/new', label: 'Register a patient', icon: ICON_FOR['/patients/new'] })
    if (n.href === '/records') for (const v of TODO_VIEWS) work.push({ href: '/records', view: v.view, label: v.label, icon: v.icon, sub: true })
  }
  const menu = menuFor(role)
  for (const m of menu) if (!m.href.startsWith('/account/')) work.push({ href: m.href, label: m.label, icon: ICON_FOR[m.href] ?? 'circle' })

  const groups: SideGroup[] = []
  if (work.length) groups.push({ label: 'Work', items: work })
  if (role === 'org_admin' || role === 'auditor') {
    const overview = (SECTIONS.overview.roles as readonly string[]).includes(role)
    if (overview) groups.push({ label: role === 'org_admin' ? 'Admin' : 'Audit', items: [{ href: '/admin', label: 'Overview', icon: 'layout-dashboard' }] })
    for (const g of groupsFor(role)) groups.push({ label: g.title, items: g.pages.map((p) => ({ href: p.href, label: p.label, icon: ADMIN_ICON[p.href] ?? 'circle' })) })
  }
  groups.push({ label: 'Account', items: menu.filter((m) => m.href.startsWith('/account/')).map((m) => ({ href: m.href, label: m.label, icon: ICON_FOR[m.href] ?? 'circle' })) })
  return groups
}

const ADMIN_ICON: Record<string, string> = {
  '/admin/staff': 'users', '/admin/devices': 'tablet-smartphone', '/admin/safety': 'shield-alert', '/admin/break-glass': 'siren',
  '/admin/audit': 'history', '/admin/rules': 'list-checks', '/admin/metrics': 'chart-column', '/admin/measurement': 'clipboard-list',
  '/admin/erasure': 'eraser', '/admin/duplicates': 'copy', '/admin/settings': 'settings',
}

/** A patient's record, in three groups. Only the sections this role may open are listed. */
const PATIENT_GROUPS: { label: string; items: { key: PatientTabKey; label: string; icon: string }[] }[] = [
  { label: 'Patient record', items: [
    { key: 'overview', label: 'Overview', icon: 'layout-dashboard' },
    { key: 'records', label: 'All records', icon: 'folder-open' },
    { key: 'ledger', label: 'What’s new', icon: 'sparkles' },
    { key: 'timeline', label: 'Timeline', icon: 'calendar-range' },
    { key: 'statements', label: 'Patient said', icon: 'message-circle' },
  ] },
  { label: 'Papers', items: [
    { key: 'documents', label: 'Documents', icon: 'file-text' },
    { key: 'completeness', label: 'Missing papers', icon: 'file-x' },
    { key: 'requests', label: 'Requests', icon: 'mail' },
    { key: 'preauth', label: 'Pre-auth file', icon: 'folder-check' },
  ] },
  { label: 'Sharing and privacy', items: [
    { key: 'shares', label: 'Share links', icon: 'share-2' },
    { key: 'consent', label: 'Consent & access', icon: 'shield-check' },
    { key: 'audit', label: 'Who opened this record', icon: 'history' },
    { key: 'card', label: 'Records card', icon: 'id-card' },
  ] },
]

/** The record's sections for a role, as sidebar groups. */
export function patientGroupsFor(patientId: string, role: StaffRole): SideGroup[] {
  return PATIENT_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => tabAllowed(i.key, role)).map((i) => ({ href: `/patients/${patientId}/${i.key}`, label: i.label, icon: i.icon })),
  })).filter((g) => g.items.length > 0)
}

const UUID = /^\/patients\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/|$)/i
/** The patient id when the path is inside a patient's record, else null. */
export const patientIdIn = (pathname: string): string | null => UUID.exec(pathname)?.[1] ?? null

/** The one item that is "current": a `?view=` sub-page when its view is chosen, else the longest href the path starts with. */
export function currentItem(items: SideItem[], pathname: string, view: string | null): SideItem | null {
  const fits = items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
  return fits.find((i) => i.view && i.view === view) ?? fits.filter((i) => !i.view).sort((a, b) => b.href.length - a.href.length)[0] ?? null
}
