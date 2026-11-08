import Link from 'next/link'
import { Check, Circle } from 'lucide-react'
import { Notice } from '@/components/registration/Notice'
import { PreVisitLinkButton } from '@/components/registration/PreVisitLinkButton'
import { PATIENT_TABS } from '@/components/shell'
import { FirstLook } from '@/components/doctor/FirstLook'
import { OncologyFacts } from '@/components/doctor/OncologyFacts'
import { Badge, BrassSeal, ButtonLink, EmptyFrame, EXPLAIN, Explainer, KeyValue, Placard, ProgressMeter, SectionHeader } from '@/components/ui'
import { formatDateIN } from '@/core/copy'
import { tabAllowed } from '@/lib/patient-tabs'
import { loadDoctorOverview } from '@/server/registration/doctor-overview'
import { loadOverview } from '@/server/registration/overview'
import { withPatientAccess } from '@/server/registration/page'

const DATETIME = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const ENCOUNTER = { onboarding: 'First visit', returning: 'Returning visit', between: 'Between visits' } as Record<string, string>

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const got = await withPatientAccess(id, async (tx, s) => ({ o: await loadOverview(tx, id), role: s.role, doctor: s.role === 'clinician' || s.role === 'records' ? await loadDoctorOverview(tx, id, s) : null }))
  if (!got) return null // denied or missing: the workspace layout shows why
  const { o, role, doctor } = got
  if (!o) return null
  const p = o.patient
  const done = o.steps.filter((s) => s.done).length
  const links = PATIENT_TABS.filter(([k]) => k !== 'overview' && tabAllowed(k, role))

  return (
    <div className="grid gap-10 py-8">
      {p.disclosure !== 'cleared' && (
        <Notice title="Use neutral wording with the patient and family">
          Disclosure is {p.disclosure === 'unknown' ? 'unknown' : 'not cleared'}. Anything the patient or family sees (messages, the card, printed sheets) avoids diagnosis words; staff screens show everything.
        </Notice>
      )}
      {p.deceased && <Notice tone="conflict" title="Recorded as deceased">Patient and caregiver access is closed.</Notice>}

      {doctor && <FirstLook rows={doctor.firstLook} />}
      {doctor && <OncologyFacts v={doctor.oncology} />}

      <div className="grid gap-6 lg:grid-cols-3">
        {role !== 'clinician' && <Placard kicker="Setting up this record" title={`${done} of ${o.steps.length} steps done`} className="lg:col-span-1">
          <ProgressMeter label="Onboarding progress" value={done} max={o.steps.length} detail={`${done} / ${o.steps.length}`} />
          <ul className="mt-4 grid gap-1.5 text-[15px] text-ink">
            {o.steps.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                {s.done ? <Check aria-hidden className="size-4 text-sage-ink" /> : <Circle aria-hidden className="size-4 text-control" />}
                <span className={s.done ? '' : 'text-muted'}>{s.label}</span>
                <span className="sr-only">{s.done ? ' (done)' : ' (not yet)'}</span>
              </li>
            ))}
          </ul>
        </Placard>}

        <Placard kicker="Current visit" title={o.encounter ? ENCOUNTER[o.encounter.type] ?? o.encounter.type : 'No visit started yet'}>
          {o.encounter ? (
            <KeyValue items={[{ label: 'Started', value: DATETIME.format(o.encounter.startedAt) }, { label: 'Consent', value: o.consent ? `On file (${o.consent.language.toUpperCase()})` : 'None active' }]} />
          ) : (
            <p>A visit starts when the patient is verified at the desk or newly registered.</p>
          )}
          <div className="mt-4"><PreVisitLinkButton patientId={id} /></div>
        </Placard>

        <Placard kicker="Last sealed visit" title={o.snapshot ? `Sealed ${DATETIME.format(o.snapshot.sealedAt)}` : 'Nothing sealed yet'}>
          {o.snapshot ? (
            <div className="grid gap-3">
              <div className="flex items-center gap-4">
                <BrassSeal code={o.snapshot.sha256} label="Sealed" size={80} />
                <p className="text-[15px]">The record as it stood at that visit. It cannot be changed afterwards.</p>
              </div>
              <Link className="w-fit text-sm text-setu-ink underline decoration-brass underline-offset-4" href={`/patients/${id}/timeline`}>See the record as it was then</Link>
              <Explainer>{EXPLAIN.seal}</Explainer>
            </div>
          ) : (
            <p>A clinician seals the record at the end of the first visit, after checking the key items.</p>
          )}
        </Placard>
      </div>

      <section aria-labelledby="wall-h" className="grid gap-6">
        <SectionHeader
          kicker="Documents" title={<span id="wall-h">Documents on file</span>}
          description={`${o.docTotal} document${o.docTotal === 1 ? '' : 's'} on the record${o.awaitingDecision ? `, ${o.awaitingDecision} held until a person decides whose it is` : ''}${o.needsReview ? `, ${o.needsReview} hard to read and needing a check` : ''}.`}
          actions={<ButtonLink href={`/patients/${id}/documents`} variant="secondary">Open documents</ButtonLink>}
        />
        {o.docs.length === 0 && o.missing.length === 0 ? (
          <p className="text-muted">No documents have been added yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {o.docs.map((d) => (
              <li key={d.type}>
                <Link href={`/patients/${id}/documents`} className="inline-flex min-h-11 items-center gap-2 border border-rule bg-matte px-3 text-[15px] hover:bg-spotlight">
                  <span className="font-display text-xl tabular-nums">{d.count}</span>{d.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {o.missing.length > 0 && (
          <div className="grid gap-5 border-t border-rule pt-6">
            <p className="ds-kicker">Referred to but not in file ({o.missing.length})</p>
            <div className="grid gap-6 md:grid-cols-2">
              {o.missing.map((m, i) => (
                <EmptyFrame
                  key={m.id} animate delay={i * 90} title={m.label} detail={m.detail} status={m.state}
                  action={<Link className="text-sm underline" href={`/patients/${id}/completeness`}>Open the missing-papers checklist</Link>}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="go-h" className="grid gap-4">
        <h2 id="go-h" className="ds-kicker">Go to</h2>
        <ul className="flex flex-wrap gap-2">
          {links.map(([k, label]) => <li key={k}><Link className="inline-flex h-11 items-center border border-rule bg-matte px-4 text-sm hover:bg-spotlight" href={`/patients/${id}/${k}`}>{label}</Link></li>)}
          <li><Link className="inline-flex h-11 items-center border border-rule bg-matte px-4 text-sm hover:bg-spotlight" href={`/patients/${id}/card`}>Records card</Link></li>
        </ul>
        <p className="text-sm text-faint">Registered contact: {p.primaryContact === 'caregiver' ? 'the caregiver' : 'the patient'}{p.minor && <> · <Badge tone="unverified">Minor</Badge></>} · Last consent: {o.consent ? formatDateIN(o.consent.recordedAt.toISOString()) : 'none active'}</p>
        <p className="text-sm text-faint" data-testid="abha-status">
          {o.abha ? `ABHA on file (${o.abha.verified ? 'verified' : 'unverified'}).` : 'No ABHA number on file.'}
        </p>
      </section>
    </div>
  )
}
