import Link from 'next/link'
import { Check, Circle, FolderOpen } from 'lucide-react'
import { Notice } from '@/components/registration/Notice'
import { PreVisitLinkButton } from '@/components/registration/PreVisitLinkButton'
import { NewItems, NextSteps, RecordGlance, SummaryTiles } from '@/components/doctor/Dashboard'
import { Badge, ProgressMeter } from '@/components/ui'
import { formatDateIN } from '@/core/copy'
import { isEmptyOncology } from '@/core/doctor/oncology'
import { loadDoctorOverview } from '@/server/registration/doctor-overview'
import { loadOverview } from '@/server/registration/overview'
import { withPatientAccess } from '@/server/registration/page'

const DATETIME = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
const ENCOUNTER = { onboarding: 'First visit', returning: 'Returning visit', between: 'Between visits' } as Record<string, string>
const linkCls = 'font-medium text-setu-ink underline decoration-link underline-offset-4'

/** One fact in a side card: a label on the left, its value on the right. */
const Row = ({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) => (
  <div className="flex items-baseline justify-between gap-4 py-2">
    <dt className="text-muted">{label}</dt>
    <dd className="text-right" data-testid={testId}>{children}</dd>
  </div>
)

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const got = await withPatientAccess(id, async (tx, s) => ({ o: await loadOverview(tx, id), role: s.role, doctor: s.role === 'clinician' || s.role === 'records' ? await loadDoctorOverview(tx, id, s) : null }))
  if (!got) return null // denied or missing: the workspace layout shows why
  const { o, role, doctor } = got
  if (!o) return null
  const p = o.patient
  const done = o.steps.filter((s) => s.done).length
  const heldN = doctor ? doctor.firstLook.find((r) => r.key === 'held')?.count ?? 0 : null
  const canRecords = role === 'records' || role === 'clinician'
  // Decision 13: once this visit is sealed, a quiet link to the 1-minute study form (no popup). The form holds no patient details.
  const visitSealed = role === 'clinician' && !!o.encounter && !!o.snapshot && o.snapshot.sealedAt >= o.encounter.startedAt
  const newRow = doctor?.firstLook.find((r) => r.key === 'new')

  const setup = (
    <section aria-labelledby="setup-h" className="rounded-lg border border-rule bg-surface p-4 shadow-card sm:p-5">
      <p className="ds-kicker">Setting up this record</p>
      <h2 id="setup-h" className="mt-1 text-lg">{`${done} of ${o.steps.length} steps done`}</h2>
      <ProgressMeter className="mt-3" label="Onboarding progress" value={done} max={o.steps.length} detail={`${done} / ${o.steps.length}`} />
      <ul className="mt-4 grid gap-2 text-[15px]">
        {o.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2.5">
            {s.done ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-sage-ink" /> : <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-control" />}
            <span className={s.done ? '' : 'text-muted'}>{s.label}</span>
            <span className="sr-only">{s.done ? ' (done)' : ' (not yet)'}</span>
          </li>
        ))}
      </ul>
    </section>
  )

  return (
    <div className="grid gap-5 py-5">
      {p.deceased && <Notice tone="conflict" title="Recorded as deceased">Patient and caregiver access is closed.</Notice>}

      {doctor && <SummaryTiles rows={doctor.firstLook} />}

      {/* Phone order: next steps, the record, then the visit facts. Desktop: the record on the left, a rail on the right. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr]">
        <div className="grid gap-4 lg:col-start-2 lg:row-start-1">
          {p.disclosure !== 'cleared' && (
            <Notice title="Use neutral wording with the patient and family">
              Disclosure is {p.disclosure === 'unknown' ? 'unknown' : 'not cleared'}. Anything the patient or family sees (messages, the card, printed sheets) avoids diagnosis words; staff screens show everything.
            </Notice>
          )}

          {doctor ? (
            <NextSteps rows={doctor.firstLook}>
              {canRecords && <Link href={`/patients/${id}/records`} className="flex min-h-11 items-center gap-2 text-[15px] font-medium text-setu-ink"><FolderOpen aria-hidden className="size-4" />Open all records</Link>}
              {role !== 'org_admin' && <PreVisitLinkButton patientId={id} />}
            </NextSteps>
          ) : (
            role !== 'org_admin' && <div className="rounded-lg border border-rule bg-surface p-4 shadow-card"><PreVisitLinkButton patientId={id} /></div>
          )}

        </div>
        <div className="grid min-w-0 gap-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {doctor && !isEmptyOncology(doctor.oncology) && <RecordGlance v={doctor.oncology} />}
          {doctor && newRow && <NewItems row={newRow} />}
          {!doctor && setup}
          {visitSealed && (
            <p className="text-[15px] text-muted" data-testid="study-form-link">
              This visit is sealed.{' '}
              <Link className={linkCls} href={`/measure?visit=${o.encounter!.id}`}>Fill the 1-minute study form</Link>
            </p>
          )}
        </div>

        <aside className="grid gap-4 self-start lg:col-start-2 lg:row-start-2" aria-label="Visit and patient details">
          <section aria-labelledby="visit-h" className="rounded-lg border border-rule bg-surface p-4 shadow-card" data-testid="overview-strip">
            <div className="flex items-center justify-between gap-3">
              <h2 id="visit-h" className="text-lg">This visit</h2>
              <Badge tone={o.encounter ? 'setu' : 'neutral'}>{o.encounter ? ENCOUNTER[o.encounter.type] ?? o.encounter.type : 'No visit started yet'}</Badge>
            </div>
            <dl className="mt-2 divide-y divide-rule text-[15px]">
              {o.encounter && <Row label="Started">{DATETIME.format(o.encounter.startedAt)}</Row>}
              <Row label="Consent">{o.consent ? `On file (${o.consent.language.toUpperCase()})` : 'None active'}</Row>
              <Row label="Papers on file">{o.docTotal}</Row>
              {/* The same number as the Held tile (DOC-01). */}
              {(heldN ?? o.awaitingDecision) ? <Row label="Held for a person to check">{heldN ?? o.awaitingDecision}</Row> : null}
              {heldN === null && o.needsReview ? <Row label="Hard to read">{o.needsReview}</Row> : null}
              <Row label="Last sealed">
                {o.snapshot
                  ? <Link className={linkCls} href={`/patients/${id}/timeline`}>{formatDateIN(o.snapshot.sealedAt.toISOString())}: see it as it was</Link>
                  : 'Not sealed yet'}
              </Row>
            </dl>
          </section>

          <section aria-labelledby="details-h" className="rounded-lg border border-rule bg-surface p-4 shadow-card">
            <h2 id="details-h" className="text-lg">Patient details</h2>
            <dl className="mt-2 divide-y divide-rule text-[15px]">
              <Row label="Registered contact">{p.primaryContact === 'caregiver' ? 'The caregiver' : 'The patient'}{p.minor && <> <Badge tone="unverified">Minor</Badge></>}</Row>
              <Row label="Last consent">{o.consent ? formatDateIN(o.consent.recordedAt.toISOString()) : 'None active'}</Row>
              <Row label="ABHA" testId="abha-status">{o.abha ? `ABHA on file (${o.abha.verified ? 'verified' : 'unverified'}).` : 'No ABHA number on file.'}</Row>
            </dl>
            <Link className={`${linkCls} mt-2 inline-flex min-h-11 items-center`} href={`/patients/${id}/card`}>Records card</Link>
          </section>

          {doctor && role !== 'clinician' && setup}
        </aside>
      </div>
    </div>
  )
}
