import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { IdCheckPanel } from '@/components/registration/IdCheckPanel'
import { EmailDropPanel } from '@/components/inbound/EmailDropPanel'
import { CardPanel, CaregiverPanel, ConsentActions, DisclosurePanel, PrimaryContactPanel, StatusPanel } from '@/components/registration/ConsentAccess'
import { Badge, EmptyState, Frame, Table } from '@/components/ui'
import { consents, shareLinks, staff } from '@/db/schema'
import { now } from '@/server/clock'
import { inboundEmailView } from '@/server/inbound/staff'
import { activeConsent, loadPatient } from '@/server/patients'
import { accessLog } from '@/server/registration/audit-view'
import { patientOwnTarget } from '@/server/registration/contact'
import { loadIdRecord } from '@/server/privacy/privacy'
import { withPatientAccess } from '@/server/registration/page'

const STAMP = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const PURPOSE_LABEL = { store: 'Care at this hospital', ai: 'AI-assisted reading', share: 'Second opinion (share)', abdm: 'ABDM pull', metrics: 'Anonymised metrics', team: 'Team case discussion' } as const

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid gap-1 border-b border-rule pb-2">
        <h2 id={id} className="text-xl tracking-[-0.02em]">{title}</h2>
        {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const d = await withPatientAccess(id, async (tx, s) => {
    const patient = await loadPatient(tx, id)
    if (!patient) return null
    const [current, history, links, log, canCode, drop, idRecord] = await Promise.all([
      activeConsent(tx, id),
      tx.select().from(consents).where(eq(consents.patientId, id)).orderBy(desc(consents.recordedAt), desc(consents.id)),
      tx.select({ id: shareLinks.id }).from(shareLinks).where(and(eq(shareLinks.patientId, id), isNull(shareLinks.revokedAt), gt(shareLinks.expiresAt, await now(s.orgId)))),
      accessLog(tx, id),
      patientOwnTarget(tx, id),
      inboundEmailView(tx, id),
      loadIdRecord(tx, id),
    ])
    const witnesses = [...new Set(history.map((h) => h.witnessedBy).filter((x): x is string => !!x))]
    const names = witnesses.length ? await tx.select({ id: staff.id, name: staff.name }).from(staff).where(inArray(staff.id, witnesses)) : []
    return { patient, current, history, activeLinks: links.length, log, canCode: !!canCode, drop, idRecord, witness: new Map(names.map((n) => [n.id, n.name])), role: s.role }
  })
  if (!d) return null
  const { patient: p, current } = d
  const role = d.role
  const turned18 = p.minor && p.ageYears != null && p.ageYears >= 18
  const actorLabel = (h: (typeof d.history)[number]) => (h.actorType === 'staff' ? 'Staff' : h.actorType === 'caregiver' ? 'Caregiver' : 'Patient')

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 py-8">
      <Section id="current-h" title="Consent now" description="Checked on every use, never cached. A withdrawal takes effect on the next request.">
        {current ? (
          <Frame matte>
            <div className="grid gap-4 p-4 sm:p-6">
              <ul className="flex flex-wrap gap-2" aria-label="Purposes">
                {(Object.keys(PURPOSE_LABEL) as (keyof typeof PURPOSE_LABEL)[]).map((k) => (
                  <li key={k}><Badge tone={current.purposes[k] ? 'verified' : 'shadow'}>{PURPOSE_LABEL[k]}: {current.purposes[k] ? 'yes' : 'no'}</Badge></li>
                ))}
              </ul>
              <p className="text-sm text-muted">Notice {current.noticeVersion} · {current.language === 'hi' ? 'Hindi' : 'English'} · recorded {STAMP.format(current.recordedAt)} · {d.activeLinks} active share link{d.activeLinks === 1 ? '' : 's'}</p>
              {!current.purposes.ai && <p className="text-sm text-muted">AI processing is declined: this patient is in manual mode and nothing is sent to an AI provider.</p>}
              <ConsentActions patientId={id} current={current.purposes} language={p.preferredLanguage} />
            </div>
          </Frame>
        ) : (
          <Frame matte>
            <div className="grid gap-4 p-4 sm:p-6">
              <p>No consent is active. Staff cannot open this record until new consent is recorded.</p>
              <ConsentActions patientId={id} current={null} language={p.preferredLanguage} />
            </div>
          </Frame>
        )}
      </Section>

      <Section id="people-h" title="Caregivers and contact" description="A caregiver can never confirm their own delegation: the patient's phone (or an in-person witness) does.">
        <CaregiverPanel
          patientId={id} minor={p.minor} patientCanReceiveCode={d.canCode}
          caregivers={p.caregivers.map(({ id: cid, name, relation, phoneMasked, isGuardian, active }) => ({ id: cid, name, relation, phoneMasked, isGuardian, active }))}
        />
        <PrimaryContactPanel patientId={id} current={p.primaryContact} minor={p.minor} />
      </Section>

      <Section id="email-drop-h" title="Email drop" description="A private address for this record. Only addresses verified in person may send to it.">
        <EmailDropPanel
          patientId={id} configured={!!d.drop.domain} address={d.drop.address} canManage={role === 'desk' || role === 'records' || role === 'clinician'}
          contacts={d.drop.contacts.map((c) => ({ ...c, verifiedAt: c.verifiedAt.toISOString() }))}
          caregivers={p.caregivers.map(({ id: cid, name, relation, active }) => ({ id: cid, name, relation, active }))}
        />
      </Section>

      <Section id="idcheck-h" title="ID check (optional)" description="Record that you looked at an ID. Only the last 4 characters are kept, never the full number.">
        <IdCheckPanel patientId={id} record={d.idRecord} />
      </Section>

      <Section id="disclosure-h" title="Disclosure status" description="Controls the wording of everything the patient and family see. Clinician only; every change is audited.">
        <DisclosurePanel patientId={id} current={p.disclosure} canEdit={role === 'clinician'} />
      </Section>

      <Section id="card-h" title="Records card" description="Lost or stolen? The old card answers “revoked” as soon as a new one is issued.">
        <CardPanel patientId={id} revoked={p.tokenRevoked} canManage={role === 'desk' || role === 'records'} />
      </Section>

      {(turned18 || role === 'records' || role === 'clinician') && (
        <Section id="status-h" title="Record status">
          <StatusPanel patientId={id} deceased={p.deceased} canSetDeceased={role === 'records' || role === 'clinician'} canTransfer={turned18} patientCanReceiveCode={d.canCode} />
        </Section>
      )}

      <Section id="history-h" title="Consent history" description="Append-only: each entry stays as recorded.">
        {d.history.length === 0 ? <EmptyState title="No consent entries" /> : (
          <Table caption={`${d.history.length} entr${d.history.length === 1 ? 'y' : 'ies'}`}>
            <thead><tr><th>When</th><th>Entry</th><th>By</th><th>Method</th><th>Purposes</th><th>Notice</th></tr></thead>
            <tbody>
              {d.history.map((h) => (
                <tr key={h.id}>
                  <td className="font-mono text-xs whitespace-nowrap">{STAMP.format(h.recordedAt)}</td>
                  <td><Badge tone={h.action === 'withdraw' ? 'conflict' : h.action === 'grant' ? 'verified' : 'setu'}>{h.action}</Badge></td>
                  <td>{actorLabel(h)}{h.witnessedBy && <span className="text-muted"> · witness {d.witness.get(h.witnessedBy) ?? '—'}</span>}</td>
                  <td>{h.method === 'desk_assisted' ? 'Desk, witnessed' : 'Own code'}</td>
                  <td className="text-sm">{h.action === 'withdraw' ? 'all withdrawn' : (Object.keys(PURPOSE_LABEL) as (keyof typeof PURPOSE_LABEL)[]).filter((k) => h.purposes[k]).map((k) => PURPOSE_LABEL[k]).join(', ') || 'none'}</td>
                  <td className="font-mono text-xs">{h.noticeVersion} · {h.language}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section id="access-h" title="Access log" description="Who viewed or exported what, and every attempt to open a share link. The patient sees the same list.">
        {d.log.events.length === 0 && d.log.shareViews.length === 0 ? <EmptyState title="Nothing has been viewed or exported yet" /> : (
          <div className="grid gap-6">
            {d.log.events.length > 0 && (
              <Table caption="Staff and system access">
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th></tr></thead>
                <tbody>{d.log.events.map((e) => (
                  <tr key={e.seq}>
                    <td className="font-mono text-xs whitespace-nowrap">{STAMP.format(e.at)}</td>
                    <td>{e.actorName ?? (e.actorRole === 'system' ? 'System' : 'Patient side')} <Badge>{e.actorRole}</Badge></td>
                    <td className="font-mono text-xs">{e.action}</td>
                    <td className="font-mono text-xs">{e.targetType ?? '—'}</td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
            {d.log.shareViews.length > 0 && (
              <Table caption="Share-link views">
                <thead><tr><th>When</th><th>Link</th><th>Outcome</th></tr></thead>
                <tbody>{d.log.shareViews.map((v) => (
                  <tr key={v.id}>
                    <td className="font-mono text-xs whitespace-nowrap">{STAMP.format(v.at)}</td>
                    <td className="font-mono text-xs">{v.shareLinkId.slice(0, 8)}</td>
                    <td><Badge tone={v.outcome === 'viewed' ? 'neutral' : 'unverified'}>{v.outcome.replace('_', ' ')}</Badge></td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </div>
        )}
      </Section>
    </div>
  )
}
