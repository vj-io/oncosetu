import { Check, TriangleAlert } from 'lucide-react'
import { Badge, EmptyState, EXPLAIN, Explainer, SectionHeader, Table } from '@/components/ui'
import { describeAction, describeTarget } from '@/core/doctor/audit-words'
import { patientAuditRows } from '@/server/registration/audit-view'
import { withPatientAccess } from '@/server/registration/page'
import { verifyAuditChain } from '@/server/audit'

const STAMP = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await withPatientAccess(id, async (tx, s) => ({ rows: await patientAuditRows(tx, id), orgId: s.orgId }))
  if (!data) return null
  // ponytail: verifies the org's whole chain on each view, O(rows in the org); cache the last verified seq before the log grows past ~100k rows.
  const chain = await verifyAuditChain(data.orgId)
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-6 py-8">
      <SectionHeader
        kicker="Activity log" title="Everything that happened to this record"
        description="Who did what, and when. The log never stores patient names, phone numbers or document text."
        actions={chain.ok
          ? <Badge tone="verified" icon={<Check />}>Log intact · {chain.checked} entries checked</Badge>
          : <Badge tone="conflict" icon={<TriangleAlert />}>Log tampered with at entry {chain.brokenAt}</Badge>}
      />
      <Explainer>{EXPLAIN.audit}</Explainer>
      {data.rows.length === 0 ? (
        <EmptyState title="No audit entries for this patient yet" />
      ) : (
        <Table caption={`${data.rows.length} most recent entries, newest first`}>
          <thead><tr><th>#</th><th>When</th><th>Who</th><th>Role</th><th>What happened</th><th>About</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.seq}>
                <td className="font-mono text-xs">{r.seq}</td>
                <td className="font-mono text-xs whitespace-nowrap">{STAMP.format(r.at)}</td>
                <td>{r.actorName ?? (r.actorRole === 'system' ? 'The system' : 'Patient or family')}</td>
                <td><Badge>{r.actorRole}</Badge></td>
                <td>{describeAction(r.action)}</td>
                <td className="text-[14px]">{describeTarget(r.targetType)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}
