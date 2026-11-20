import type { ReactNode } from 'react'
import Link from 'next/link'
import { AdminNav } from '@/components/admin/AdminNav'
import { groupsFor, roleLabel } from '@/components/admin/groups'
import { Notice } from '@/components/registration/Notice'
import { withOrg } from '@/db'
import { activeAdminIds, reviewState, unreviewedGrants } from '@/server/admin/ops'
import { SECTIONS } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

// Desk (and anyone signed out) never reaches a section: 403 / login here. Each page narrows the roles further.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const s = await requireStaff(['org_admin', 'auditor', 'clinician', 'records'])
  // FR-ID-10: the alert for emergency access on every admin page until reviewed. Administrators see all open grants;
  // an auditor sees only those they may review (a hospital with one administrator).
  const { grants, admins } = s.role === 'org_admin' || s.role === 'auditor'
    ? await withOrg(s.orgId, async (tx) => ({ grants: await unreviewedGrants(tx, s.orgId), admins: await activeAdminIds(tx, s.orgId) }))
    : { grants: [], admins: [] as string[] }
  const mine = grants.filter((g) => reviewState({ reviewedAt: null, grantStaffId: g.staffId, viewerId: s.staffId, viewerRole: s.role, activeAdminIds: admins }).kind === 'can_review')
  const shown = s.role === 'org_admin' ? grants : mine
  const alerts = shown.length
  const who = [...new Set(shown.map((g) => roleLabel(g.role)))].join(' or ')
  const needsMe = mine.length
  return (
    <div className="grid grid-cols-1 gap-8">
      <AdminNav groups={groupsFor(s.role)} />
      {alerts > 0 && (
        <Notice tone="conflict" title={`Emergency access used: ${alerts} ${alerts === 1 ? 'grant' : 'grants'} not yet reviewed`}>
          A staff member ({who}) opened a record outside the patient&apos;s consent.{' '}
          {needsMe > 0 ? 'You can review it. ' : 'Another person must review it. '}<Link className="text-ink underline" href={SECTIONS.breakGlass.href}>Review the reason given</Link>.
        </Notice>
      )}
      {children}
    </div>
  )
}
