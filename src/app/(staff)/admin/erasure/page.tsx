import { Badge, EmptyState, SectionHeader, Table } from '@/components/ui'
import { withOrg } from '@/db'
import { accession, istDate } from '@/server/admin/format'
import { sectionRoles } from '@/server/admin/sections'
import { listErasureRequests, type ErasureState } from '@/server/erasure/erasure'
import { requireStaff } from '@/server/session'
import { ExecuteErasure, RunDueErasures } from './ErasureActions'

export const metadata = { title: 'Erasure requests · Admin · OncoSetu' }

const STATE = {
  queued: { tone: 'unverified', label: 'Queued' },
  scheduled: { tone: 'setu', label: 'Scheduled' },
  completed: { tone: 'verified', label: 'Completed' },
  cancelled: { tone: 'shadow', label: 'Cancelled' },
} as const satisfies Record<ErasureState, { tone: 'unverified' | 'setu' | 'verified' | 'shadow'; label: string }>
const BY = { patient: 'Patient', caregiver: 'Caregiver', staff: 'Staff on patient request' } as const
const countsText = (c: Record<string, number>) =>
  Object.entries(c).filter(([, n]) => n > 0).map(([t, n]) => `${t.replace(/_/g, ' ')} ${n}`).join(' · ') || 'no stored rows'

export default async function ErasurePage() {
  const s = await requireStaff(sectionRoles('erasure'))
  const rows = await withOrg(s.orgId, (tx) => listErasureRequests(tx, s.orgId))
  const due = rows.filter((r) => r.due).length
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionHeader as="h1" kicker="Admin · Retention" title="Erasure requests"
        description="Requests recorded after a patient withdrew consent . Access stopped when consent was withdrawn. A request becomes eligible once the retention period in Settings has run from the request and 3 years have passed since the last encounter; a daily job then erases it, or execute it here. Patients are shown by accession code only." />
      {rows.length > 0 && <div><RunDueErasures count={due} /></div>}
      {rows.length === 0 ? <EmptyState title="No erasure requests" description="A request appears here when a patient, a caregiver, or records staff on the patient's request records one after consent is withdrawn." /> : (
        <Table caption="Erasure requests">
          <thead><tr><th>Patient</th><th>Requested</th><th>By</th><th>Eligible after</th><th>State</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-[13px]">{accession(r.patientId)}</td>
                <td className="text-sm">{istDate(r.requestedAt)}</td>
                <td className="text-sm">{BY[r.requestedByKind]}</td>
                <td className="text-sm">{istDate(r.eligibleAfter)}</td>
                <td><Badge tone={STATE[r.state].tone}>{r.due ? 'Due' : STATE[r.state].label}</Badge>{r.completedAt && <span className="mt-1 block font-mono text-[12px] text-muted">{istDate(r.completedAt)}</span>}</td>
                <td className="text-right text-sm">
                  {(r.state === 'queued' || r.state === 'scheduled') && <ExecuteErasure id={r.id} accession={accession(r.patientId)} due={r.due} eligibleAfter={istDate(r.eligibleAfter)} />}
                  {r.counts && (
                    <details className="max-w-xs text-left font-mono text-[12px] text-muted">
                      <summary className="cursor-pointer">Rows per table</summary>
                      {countsText(r.counts)}
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
