// Share links, staff tab (J5, FR-PAS-02..04): create one at the desk on the patient's behalf, see every open, switch off.
import { notFound } from 'next/navigation'
import { CreateShareForm } from '@/components/shares/CreateShareForm'
import { RevokeShareButton } from '@/components/shares/RevokeShareButton'
import { Badge, EmptyState, SectionHeader, Table, type Tone } from '@/components/ui'
import { formatDateIN, istDate } from '@/core/copy'
import { formatDateTimeIN } from '@/server/portal/summary'
import { withPatientAccess } from '@/server/registration/page'
import { listSharesForStaff } from '@/server/shares/shares'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Share links · OncoSetu' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUS: Record<string, Tone> = { active: 'verified', expired: 'shadow', revoked: 'shadow', locked: 'conflict' }
const OUTCOME: Record<string, string> = {
  viewed: 'Opened', wrong_passcode: 'Wrong passcode', locked: 'Locked', expired: 'Tried after expiry', revoked: 'Tried after switch-off', unavailable: 'Tried after consent withdrawn',
}

export default async function SharesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  await requireStaff(['desk', 'records', 'clinician'])
  const rows = await withPatientAccess(id, (tx, s) => listSharesForStaff(tx, s.orgId, id))
  if (!rows) return null // the workspace layout explains the denial
  return (
    <div className="grid gap-10 py-8">
      <SectionHeader
        kicker="Continuity share"
        title="Share links"
        description="A passcode-protected, expiring link to the document index of the latest sealed snapshot — headed “Document index, not a clinical summary”, with the list of documents not in file. Encrypted in this browser; the key is only in the link."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_1fr] lg:items-start">
        <CreateShareForm patientId={id} actor="staff" />
        <section aria-labelledby="links-h" className="grid min-w-0 gap-4">
          <h2 id="links-h" className="ds-kicker">Links and opens · visible to the patient</h2>
          {rows.length ? (
            <Table caption={`${rows.length} link${rows.length === 1 ? '' : 's'}`}>
              <thead><tr><th>Created</th><th>Status</th><th>Expires</th><th>Opens</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td>
                      <span className="block">{formatDateTimeIN(r.createdAt, 'en')}</span>
                      <span className="font-mono text-[11px] text-faint">{r.createdBy} · {r.scope === 'summary' ? 'index' : 'index + quotes'} · {r.passcode ? 'passcode' : 'no passcode'}</span>
                    </td>
                    <td><Badge tone={STATUS[r.status]}>{r.status}</Badge></td>
                    <td className="font-mono text-xs">{formatDateIN(istDate(r.expiresAt))}</td>
                    <td>
                      <span className="font-mono text-xs">{r.opened}</span>
                      {r.views.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[13px] text-muted">Log</summary>
                          <ol className="mt-1 grid gap-0.5 font-mono text-[11px] text-muted">
                            {r.views.map((v, i) => <li key={i}>{formatDateTimeIN(v.at, 'en')} · {OUTCOME[v.outcome] ?? v.outcome} · {v.device}</li>)}
                          </ol>
                        </details>
                      )}
                    </td>
                    <td>{r.status === 'active' || r.status === 'locked' ? <RevokeShareButton id={r.id} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <EmptyState title="No share links yet" description="Links created here or by the patient appear with every open, wrong passcode and lock." />}
        </section>
      </div>
    </div>
  )
}
