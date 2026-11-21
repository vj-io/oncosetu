import { roleLabel } from '@/components/admin/groups'
import { ReviewBreakGlass } from '@/components/admin/ReviewBreakGlass'
import { Badge, EmptyState, SectionHeader, Table } from '@/components/ui'
import { withOrg } from '@/db'
import { istDateTime } from '@/server/admin/format'
import { activeAdminIds, listBreakGlass, reviewState } from '@/server/admin/ops'
import { sectionRoles } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Emergency access · Admin · OncoSetu' }

export default async function BreakGlassPage() {
  const s = await requireStaff(sectionRoles('breakGlass'))
  const { rows, admins } = await withOrg(s.orgId, async (tx) => ({ rows: await listBreakGlass(tx, s.orgId), admins: await activeAdminIds(tx, s.orgId) }))
  const active = rows.filter((r) => r.active)
  const waiting = rows.filter((r) => !r.reviewedAt).length
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader feature as="h1" kicker="Admin · Access review" title="Emergency access (break-glass)"
        description="Staff opening a record outside the patient's consent. Each grant needs a reason, lasts 4 hours and is audited. Someone other than the person who used it reviews every grant: another administrator, or the auditor when the hospital has only one administrator. Until then it is shown as an alert on the admin pages. Patients are shown by record code only." />
      {rows.length === 0 ? <EmptyState title="No break-glass grants" description="Nobody has used break-glass access in this organisation." /> : (
        <>
          <p className="text-sm text-muted" role="status">{active.length} active now · {waiting} not yet reviewed · {rows.length} shown</p>
          <Table caption="Break-glass grants, newest first">
            <thead><tr><th>Status</th><th>Staff</th><th>Patient</th><th>Reason given</th><th>Granted</th><th>Expires</th><th>Review</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Badge tone={r.active ? 'conflict' : 'shadow'}>{r.active ? 'Active' : 'Expired'}</Badge></td>
                  <td>{r.staff}<span className="block text-[13px] text-faint font-medium">{roleLabel(r.role)}</span></td>
                  <td className="text-[13px]">{r.patient}</td>
                  <td className="max-w-sm text-[15px]">{r.reason}</td>
                  <td className="text-[13px] whitespace-nowrap">{istDateTime(r.createdAt)}</td>
                  <td className="text-[13px] whitespace-nowrap">{istDateTime(r.expiresAt)}</td>
                  <td>
                    {(() => {
                      const st = reviewState({ reviewedAt: r.reviewedAt, grantStaffId: r.staffId, viewerId: s.staffId, viewerRole: s.role, activeAdminIds: admins })
                      if (st.kind === 'done') return <span className="text-sm text-muted">Reviewed by {r.reviewedBy ?? '—'}<span className="block text-[13px]">{istDateTime(r.reviewedAt)}</span></span>
                      if (st.kind === 'can_review') return <ReviewBreakGlass id={r.id} patient={r.patient} />
                      return <span className="grid gap-1 text-sm text-muted"><Badge tone="unverified">Not yet reviewed</Badge>{st.text}</span>
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  )
}
