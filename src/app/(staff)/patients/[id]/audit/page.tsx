import { Check, TriangleAlert } from 'lucide-react'
import { Badge, EmptyState, SectionHeader, Table } from '@/components/ui'
import { patientAuditRows } from '@/server/registration/audit-view'
import { withPatientAccess } from '@/server/registration/page'
import { verifyAuditChain } from '@/server/audit'

const STAMP = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })
const short = (id: string | null) => (id ? id.replace(/-/g, '').slice(-8) : '—')

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await withPatientAccess(id, async (tx, s) => ({ rows: await patientAuditRows(tx, id), orgId: s.orgId }))
  if (!data) return null
  // ponytail: verifies the org's whole chain on each view, O(rows in the org); cache the last verified seq before the log grows past ~100k rows.
  const chain = await verifyAuditChain(data.orgId)
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-6 py-8">
      <SectionHeader
        kicker="Audit" title="Audit trail for this patient"
        description="Who did what and when. Rows hold ids and codes only, never names, phone numbers or document text."
        actions={chain.ok
          ? <Badge tone="verified" icon={<Check />}>Chain intact · {chain.checked} rows checked</Badge>
          : <Badge tone="conflict" icon={<TriangleAlert />}>Chain broken at entry {chain.brokenAt}</Badge>}
      />
      {data.rows.length === 0 ? (
        <EmptyState title="No audit entries for this patient yet" />
      ) : (
        <Table caption={`${data.rows.length} most recent entries`}>
          <thead><tr><th>#</th><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Target</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.seq}>
                <td className="font-mono text-xs">{r.seq}</td>
                <td className="font-mono text-xs whitespace-nowrap">{STAMP.format(r.at)}</td>
                <td>{r.actorName ?? (r.actorRole === 'system' ? 'System' : 'Patient side')} <span className="font-mono text-xs text-faint">{short(r.actorId)}</span></td>
                <td><Badge>{r.actorRole}</Badge></td>
                <td className="font-mono text-xs">{r.action}</td>
                <td className="font-mono text-xs">{r.targetType ?? '—'} {short(r.targetId)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}
