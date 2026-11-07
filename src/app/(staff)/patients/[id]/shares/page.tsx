import { RoleRestricted } from '@/components/shell/RoleRestricted'
// Share links, staff tab: create one at the desk on the patient's behalf, see every open, switch off.
import { notFound } from 'next/navigation'
import { CreateShareForm } from '@/components/shares/CreateShareForm'
import { RevokeShareButton } from '@/components/shares/RevokeShareButton'
import { Badge, EmptyState, EXPLAIN, Explainer, SectionHeader, Table, type Tone } from '@/components/ui'
import { Notice } from '@/components/registration/Notice'
import { sealFreshness } from '@/server/registration/doctor-overview'
import { formatDateIN, istDate } from '@/core/copy'
import { formatDateTimeIN } from '@/server/portal/summary'
import { withPatientAccess } from '@/server/registration/page'
import { listSharesForStaff } from '@/server/shares/shares'
import { requireStaff } from '@/server/session'

export const metadata = { title: 'Share links · OncoSetu' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUS: Record<string, Tone> = { active: 'verified', expired: 'shadow', revoked: 'shadow', locked: 'conflict' }
const STATUS_WORD: Record<string, string> = { active: 'Working', expired: 'Expired', revoked: 'Switched off', locked: 'Locked: too many wrong passcodes' }
const OUTCOME: Record<string, string> = {
  viewed: 'Opened', wrong_passcode: 'Wrong passcode', locked: 'Locked', expired: 'Tried after expiry', revoked: 'Tried after switch-off', unavailable: 'Tried after consent withdrawn',
}

export default async function SharesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const session = await requireStaff()
  if (!['desk', 'records', 'clinician'].includes(session.role)) return <RoleRestricted roles={['desk', 'records', 'clinician']} role={session.role} backHref={`/patients/${id}/overview`} />
  const got = await withPatientAccess(id, async (tx, s) => ({ rows: await listSharesForStaff(tx, s.orgId, id), fresh: await sealFreshness(tx, id) }))
  if (!got) return null // the workspace layout explains the denial
  const { rows, fresh } = got
  return (
    <div className="grid gap-10 py-8">
      <SectionHeader
        kicker="Share with another doctor"
        title="Share links"
        description="A link, protected by a passcode, that stops working on the date you choose. It opens the list of documents as sealed at the last visit, headed “not a clinical summary”, with the papers that are not in file. The contents are locked in this browser; the key travels only inside the link."
      />
      <Explainer>{EXPLAIN.share}</Explainer>
      {!fresh.sealedLabel && <Notice tone="unverified" title="Nothing has been sealed yet">A share link shows the record as sealed at a visit. A clinician needs to seal this visit first.</Notice>}
      {fresh.sealedLabel && fresh.newer > 0 && (
        <Notice tone="unverified" title={`This link shows the record as sealed on ${fresh.sealedLabel}`}>
          {fresh.newer} newer {fresh.newer === 1 ? 'item is' : 'items are'} not included. Seal this visit first if the other doctor should see them.
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_1fr] lg:items-start">
        <CreateShareForm patientId={id} actor="staff" allowQuotes={session.role !== 'desk'} />
        <section aria-labelledby="links-h" className="grid min-w-0 gap-4">
          <h2 id="links-h" className="ds-kicker">Links and who opened them · the patient can see this too</h2>
          {rows.length ? (
            <Table caption={`${rows.length} link${rows.length === 1 ? '' : 's'}`}>
              <thead><tr><th>Created</th><th>Status</th><th>Expires</th><th>Opened</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td>
                      <span className="block">{formatDateTimeIN(r.createdAt, 'en')}</span>
                      <span className="font-mono text-[11px] text-faint">{r.createdBy} · {r.scope === 'summary' ? 'list only' : 'list and quotes'} · {r.passcode ? 'passcode' : 'no passcode'}</span>
                    </td>
                    <td><Badge tone={STATUS[r.status]}>{STATUS_WORD[r.status] ?? r.status}</Badge></td>
                    <td className="font-mono text-xs">{formatDateIN(istDate(r.expiresAt))}</td>
                    <td>
                      <span className="font-mono text-xs">{r.opened}</span>
                      {r.views.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[13px] text-muted">Who opened it</summary>
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
