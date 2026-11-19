import Link from 'next/link'
import { Check, Circle } from 'lucide-react'
import { Notice } from '@/components/registration/Notice'
import { PreVisitLinkButton } from '@/components/registration/PreVisitLinkButton'
import { FirstLook } from '@/components/doctor/FirstLook'
import { OncologyFacts } from '@/components/doctor/OncologyFacts'
import { Badge, Placard, ProgressMeter } from '@/components/ui'
import { formatDateIN } from '@/core/copy'
import { loadDoctorOverview } from '@/server/registration/doctor-overview'
import { loadOverview } from '@/server/registration/overview'
import { withPatientAccess } from '@/server/registration/page'

const DATETIME = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const ENCOUNTER = { onboarding: 'First visit', returning: 'Returning visit', between: 'Between visits' } as Record<string, string>
const linkCls = 'text-setu-ink underline decoration-brass underline-offset-4'

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const got = await withPatientAccess(id, async (tx, s) => ({ o: await loadOverview(tx, id), role: s.role, doctor: s.role === 'clinician' || s.role === 'records' ? await loadDoctorOverview(tx, id, s) : null }))
  if (!got) return null // denied or missing: the workspace layout shows why
  const { o, role, doctor } = got
  if (!o) return null
  const p = o.patient
  const done = o.steps.filter((s) => s.done).length
  const canRecords = role === 'records' || role === 'clinician'
  // Decision 13: once this visit is sealed, a quiet link to the 1-minute study form (no popup). The form holds no patient details.
  const visitSealed = role === 'clinician' && !!o.encounter && !!o.snapshot && o.snapshot.sealedAt >= o.encounter.startedAt

  return (
    <div className="grid gap-6 py-6">
      {p.disclosure !== 'cleared' && (
        <Notice title="Use neutral wording with the patient and family">
          Disclosure is {p.disclosure === 'unknown' ? 'unknown' : 'not cleared'}. Anything the patient or family sees (messages, the card, printed sheets) avoids diagnosis words; staff screens show everything.
        </Notice>
      )}
      {p.deceased && <Notice tone="conflict" title="Recorded as deceased">Patient and caregiver access is closed.</Notice>}

      {/* One line: the visit and the papers. The tabs above lead to everything else. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-rule bg-matte px-4 py-3 text-[15px]" data-testid="overview-strip">
        <span className="font-medium">{o.encounter ? ENCOUNTER[o.encounter.type] ?? o.encounter.type : 'No visit started yet'}</span>
        {o.encounter && <span className="text-muted">started {DATETIME.format(o.encounter.startedAt)}</span>}
        <span className="text-muted">Consent {o.consent ? `on file (${o.consent.language.toUpperCase()})` : 'none active'}</span>
        <span className="text-muted">
          {o.docTotal} {o.docTotal === 1 ? 'paper' : 'papers'} on file
          {o.awaitingDecision ? `, ${o.awaitingDecision} held until a person decides whose` : ''}
          {o.needsReview ? `, ${o.needsReview} hard to read` : ''}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
          {canRecords && <Link className={linkCls} href={`/patients/${id}/records`}>Open all records</Link>}
          {!doctor && o.snapshot && <Link className={linkCls} href={`/patients/${id}/timeline`}>Last sealed {formatDateIN(o.snapshot.sealedAt.toISOString())}: see it as it was</Link>}
          <PreVisitLinkButton patientId={id} />
        </span>
      </div>

      {visitSealed && (
        <p className="text-[15px] text-muted" data-testid="study-form-link">
          This visit is sealed.{' '}
          <Link className={linkCls} href={`/measure?visit=${o.encounter!.id}`}>Fill the 1-minute study form</Link>
        </p>
      )}

      {doctor && <FirstLook rows={doctor.firstLook} />}
      {doctor && <OncologyFacts v={doctor.oncology} />}

      {role !== 'clinician' && (
        <Placard kicker="Setting up this record" title={`${done} of ${o.steps.length} steps done`}>
          <ProgressMeter label="Onboarding progress" value={done} max={o.steps.length} detail={`${done} / ${o.steps.length}`} />
          <ul className="mt-4 grid gap-1.5 text-[15px] text-ink sm:grid-cols-2">
            {o.steps.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                {s.done ? <Check aria-hidden className="size-4 shrink-0 text-sage-ink" /> : <Circle aria-hidden className="size-4 shrink-0 text-control" />}
                <span className={s.done ? '' : 'text-muted'}>{s.label}</span>
                <span className="sr-only">{s.done ? ' (done)' : ' (not yet)'}</span>
              </li>
            ))}
          </ul>
        </Placard>
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-faint">
        <span>Registered contact: {p.primaryContact === 'caregiver' ? 'the caregiver' : 'the patient'}</span>
        {p.minor && <Badge tone="unverified">Minor</Badge>}
        <span>Last consent: {o.consent ? formatDateIN(o.consent.recordedAt.toISOString()) : 'none active'}</span>
        <span data-testid="abha-status">{o.abha ? `ABHA on file (${o.abha.verified ? 'verified' : 'unverified'}).` : 'No ABHA number on file.'}</span>
        <Link className={linkCls} href={`/patients/${id}/card`}>Records card</Link>
      </p>
    </div>
  )
}
