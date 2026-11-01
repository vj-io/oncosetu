import { Badge, EmptyState, SectionHeader, Table } from '@/components/ui'
import { withOrg } from '@/db'
import { istDateTime } from '@/server/admin/format'
import { listBreakGlass } from '@/server/admin/ops'
import { sectionRoles } from '@/server/admin/sections'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Break-glass · Admin · OncoSetu' }

export default async function BreakGlassPage() {
  const s = await requireStaff(sectionRoles('breakGlass'))
  const rows = await withOrg(s.orgId, (tx) => listBreakGlass(tx, s.orgId))
  const active = rows.filter((r) => r.active)
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader as="h1" kicker="Admin · Access review (FR-ID-10)" title="Break-glass access"
        description="Clinician access to a record outside the patient's consent. Each grant needs a reason, lasts 4 hours and is audited. Patients are shown by accession code only." />
      {rows.length === 0 ? <EmptyState title="No break-glass grants" description="Nobody has used break-glass access in this organisation." /> : (
        <>
          <p className="font-mono text-sm text-muted" role="status">{active.length} active now · {rows.length} shown</p>
          <Table caption="Break-glass grants, newest first">
            <thead><tr><th>Status</th><th>Staff</th><th>Patient</th><th>Reason given</th><th>Granted</th><th>Expires</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Badge tone={r.active ? 'conflict' : 'shadow'}>{r.active ? 'Active' : 'Expired'}</Badge></td>
                  <td>{r.staff}<span className="block font-mono text-[11px] tracking-[0.1em] text-faint uppercase">{r.role}</span></td>
                  <td className="font-mono text-[13px]">{r.patient}</td>
                  <td className="max-w-sm text-[15px]">{r.reason}</td>
                  <td className="font-mono text-[13px] whitespace-nowrap">{istDateTime(r.createdAt)}</td>
                  <td className="font-mono text-[13px] whitespace-nowrap">{istDateTime(r.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  )
}
