import Link from 'next/link'
import { Check, Circle } from 'lucide-react'
import { Notice } from '@/components/registration/Notice'
import { PreVisitLinkButton } from '@/components/registration/PreVisitLinkButton'
import { PATIENT_TABS } from '@/components/shell'
import { Badge, BrassSeal, ButtonLink, EmptyFrame, Frame, KeyValue, Placard, ProgressMeter, SectionHeader } from '@/components/ui'
import { formatDateIN } from '@/core/copy'
import { tabAllowed } from '@/lib/patient-tabs'
import { loadOverview } from '@/server/registration/overview'
import { withPatientAccess } from '@/server/registration/page'

const DATETIME = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const ENCOUNTER = { onboarding: 'First visit (onboarding)', returning: 'Returning visit', between: 'Between visits' } as Record<string, string>

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const got = await withPatientAccess(id, async (tx, s) => ({ o: await loadOverview(tx, id), role: s.role }))
  if (!got) return null // denied or missing: the workspace layout shows why
  const { o, role } = got
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

      <div className="grid gap-6 lg:grid-cols-3">
        <Placard kicker="Onboarding" title={`${done} of ${o.steps.length} steps done`} accession={o.accession} className="lg:col-span-1">
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
        </Placard>

        <Placard kicker="Current encounter" title={o.encounter ? ENCOUNTER[o.encounter.type] ?? o.encounter.type : 'No encounter yet'}>
          {o.encounter ? (
            <KeyValue items={[{ label: 'Started', value: DATETIME.format(o.encounter.startedAt) }, { label: 'Consent', value: o.consent ? `${o.consent.noticeVersion}, ${o.consent.language.toUpperCase()}` : 'None active' }]} />
          ) : (
            <p>An encounter starts when the patient is verified at the desk or newly registered.</p>
          )}
          <div className="mt-4"><PreVisitLinkButton patientId={id} /></div>
        </Placard>

        <Placard kicker="Last sealed snapshot" title={o.snapshot ? `Snapshot S${o.snapshot.seq}` : 'Nothing sealed yet'}>
          {o.snapshot ? (
            <div className="flex items-center gap-4">
              <BrassSeal code={o.snapshot.sha256} label={`S${o.snapshot.seq}`} size={96} />
              <KeyValue items={[{ label: 'Hash', value: <span className="font-mono text-sm">{o.snapshot.sha256.slice(0, 8).toUpperCase()}</span> }, { label: 'Sealed', value: DATETIME.format(o.snapshot.sealedAt) }]} />
            </div>
          ) : (
            <p>The first snapshot is sealed by a clinician after verifying the key items.</p>
          )}
        </Placard>
      </div>

      <section aria-labelledby="wall-h" className="grid gap-6">
        <SectionHeader
          kicker="The gallery wall" title={<span id="wall-h">On file</span>}
          description={`${o.docTotal} document${o.docTotal === 1 ? '' : 's'} on the record${o.awaitingDecision ? `, ${o.awaitingDecision} waiting for an attachment decision` : ''}${o.needsReview ? `, ${o.needsReview} needing review` : ''}.`}
          actions={<ButtonLink href={`/patients/${id}/documents`} variant="secondary">Open documents</ButtonLink>}
        />
        {o.docs.length === 0 && o.missing.length === 0 ? (
          <p className="text-muted">The wall is empty: no documents have been added yet.</p>
        ) : (
          <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {o.docs.map((d, i) => (
              <Frame key={d.type} matte animate delay={i * 70} caption={`${d.count} on file`}>
                <Link href={`/patients/${id}/documents`} className="grid aspect-[3/4] place-content-center gap-2 p-4 text-center hover:bg-spotlight">
                  <span className="font-display text-5xl tracking-[-0.03em]">{d.count}</span>
                  <span className="text-[15px]">{d.label}</span>
                </Link>
              </Frame>
            ))}
          </div>
        )}
        {o.missing.length > 0 && (
          <div className="grid gap-5 border-t border-rule pt-6">
            <p className="ds-kicker">Empty frames · referenced but not in file ({o.missing.length})</p>
            <div className="grid gap-6 md:grid-cols-2">
              {o.missing.map((m, i) => (
                <EmptyFrame
                  key={m.id} animate delay={i * 90} title={m.label} detail={m.detail} status={m.state}
                  action={<Link className="text-sm underline" href={`/patients/${id}/completeness`}>Completeness checklist</Link>}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="go-h" className="grid gap-4">
        <h2 id="go-h" className="ds-kicker">Quick links</h2>
        <ul className="flex flex-wrap gap-2">
          {links.map(([k, label]) => <li key={k}><Link className="inline-flex h-11 items-center border border-rule bg-matte px-4 text-sm hover:bg-spotlight" href={`/patients/${id}/${k}`}>{label}</Link></li>)}
          <li><Link className="inline-flex h-11 items-center border border-rule bg-matte px-4 text-sm hover:bg-spotlight" href={`/patients/${id}/card`}>Records card</Link></li>
        </ul>
        <p className="text-sm text-faint">Registered contact: {p.primaryContact === 'caregiver' ? 'the caregiver' : 'the patient'}{p.minor && <> · <Badge tone="unverified">Minor</Badge></>} · Last consent: {o.consent ? formatDateIN(o.consent.recordedAt.toISOString()) : 'none active'}</p>
      </section>
    </div>
  )
}
