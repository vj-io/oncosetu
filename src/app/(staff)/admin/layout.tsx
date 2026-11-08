import type { ReactNode } from 'react'
import Link from 'next/link'
import { AdminNav } from '@/components/admin/AdminNav'
import { Notice } from '@/components/registration/Notice'
import { withOrg } from '@/db'
import { unreviewedBreakGlass } from '@/server/admin/ops'
import { SECTIONS } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

// Desk (and anyone signed out) never reaches a section: 403 / login here. Each page narrows the roles further.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const s = await requireStaff(['org_admin', 'auditor', 'clinician', 'records'])
  const items = Object.values(SECTIONS).filter((x) => (x.roles as readonly string[]).includes(s.role)).map(({ href, label }) => ({ href, label }))
  // FR-ID-10: the org_admin alert for break-glass access, on every admin page (an org_admin lands on /admin) until reviewed.
  const alerts = s.role === 'org_admin' ? await withOrg(s.orgId, (tx) => unreviewedBreakGlass(tx, s.orgId)) : 0
  return (
    <div className="grid grid-cols-1 gap-8">
      <AdminNav items={items} />
      {alerts > 0 && (
        <Notice tone="conflict" title={`Emergency access used: ${alerts} ${alerts === 1 ? 'grant' : 'grants'} not yet reviewed`}>
          A clinician opened a record outside the patient&apos;s consent. <Link className="text-ink underline" href={SECTIONS.breakGlass.href}>Review the reason given</Link>.
        </Notice>
      )}
      {children}
    </div>
  )
}
