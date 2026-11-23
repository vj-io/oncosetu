import Link from 'next/link'
import { Activity, CalendarRange, Check, Circle, ClipboardList, FilePlus2, FileX, FolderOpen, GitCompare, ListChecks, Sparkles, UserX } from 'lucide-react'
import { Notice } from '@/components/registration/Notice'
import { PreVisitLinkButton } from '@/components/registration/PreVisitLinkButton'
import { SigninCodeButton } from '@/components/registration/SigninCodeButton'
import { careMilestones, RecordGlance } from '@/components/doctor/Dashboard'
import { ActionList, Badge, Checklist, Legend, MilestoneLine, Panel, ProgressMeter, Ring, type ActionItem } from '@/components/ui'
import { formatDateIN } from '@/core/copy'
import { isEmptyOncology } from '@/core/doctor/oncology'
import { tabAllowed } from '@/lib/patient-tabs'
import { loadDoctorOverview } from '@/server/registration/doctor-overview'
import { loadOverview } from '@/server/registration/overview'
import { withPatientAccess } from '@/server/registration/page'

const DATETIME = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
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
  const base = `/patients/${id}`
  const done = o.steps.filter((s) => s.done).length
  const count = (k: string) => doctor?.firstLook.find((r) => r.key === k)?.count ?? 0
  const heldN = doctor ? count('held') : o.awaitingDecision
  const canRecords = role === 'records' || role === 'clinician'
  // Decision 13: once this visit is sealed, a quiet link to the 1-minute study form (no popup). The form holds no patient details.
  const visitSealed = role === 'clinician' && !!o.encounter && !!o.snapshot && o.snapshot.sealedAt >= o.encounter.startedAt
  const sealed = !!o.snapshot
  const milestones = doctor ? careMilestones(doctor.oncology, IST_DAY.format(new Date()), id) : []

  const actions: ActionItem[] = [
    ...(tabAllowed('documents', role) ? [{ href: `${base}/documents`, label: 'Add papers', icon: <FilePlus2 /> }] : []),
    ...(count('held') ? [{ href: `${base}/documents`, label: 'Review held papers', icon: <UserX />, count: count('held'), urgent: true }] : []),
    ...(count('conflicts') ? [{ href: `${base}/ledger#conflicts`, label: 'Compare sources that disagree', icon: <GitCompare />, count: count('conflicts'), urgent: true }] : []),
    ...(count('missing') ? [{ href: `${base}/completeness`, label: 'Ask for missing papers', icon: <FileX />, count: count('missing'), tone: 'unverified' as const }] : []),
    ...(count('unverified') ? [{ href: `${base}/ledger`, label: 'Check items against the page', icon: <ListChecks />, count: count('unverified'), tone: 'verified' as const }] : []),
  ]

  const setup = (
    <Panel title={`Setting up this record: ${done} of ${o.steps.length} steps done`} icon={<ClipboardList />} id="setup">
      <ProgressMeter label="Onboarding progress" value={done} max={o.steps.length} detail={`${done} / ${o.steps.length}`} />
      <ul className="grid gap-2 text-[15px] sm:grid-cols-2">
        {o.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2.5">
            {s.done ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-sage-ink" /> : <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-control" />}
            <span className={s.done ? '' : 'text-muted'}>{s.label}</span>
            <span className="sr-only">{s.done ? ' (done)' : ' (not yet)'}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )

  const visit = (
    <Panel tint title="This visit" icon={<Activity />} id="visit" aside={<Badge tone={o.encounter ? 'setu' : 'neutral'}>{o.encounter ? ENCOUNTER[o.encounter.type] ?? o.encounter.type : 'No visit started yet'}</Badge>}>
      <dl className="-mt-2 divide-y divide-rule text-[15px]" data-testid="overview-strip">
        {o.encounter && <Row label="Started">{DATETIME.format(o.encounter.startedAt)}</Row>}
        <Row label="Consent">{o.consent ? `On file (${o.consent.language.toUpperCase()})` : 'None active'}</Row>
        <Row label="Papers on file">{o.docTotal}{heldN ? `, ${heldN} held for a person to check` : ''}</Row>
        <Row label="Registered contact">{p.primaryContact === 'caregiver' ? 'The caregiver' : 'The patient'}{p.minor && <> <Badge tone="unverified">Minor</Badge></>}</Row>
        <Row label="ABHA" testId="abha-status">{o.abha ? `ABHA on file (${o.abha.verified ? 'verified' : 'unverified'}).` : 'No ABHA number on file.'}</Row>
        <Row label="Last sealed">{o.snapshot ? <Link className={linkCls} href={`${base}/timeline`}>{formatDateIN(o.snapshot.sealedAt.toISOString())}: see it as it was</Link> : 'Not sealed yet'}</Row>
      </dl>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule pt-3">
        {role !== 'org_admin' && <PreVisitLinkButton patientId={id} />}
        {role !== 'org_admin' && !p.deceased && <SigninCodeButton patientId={id} />}
        <Link className={`${linkCls} inline-flex min-h-11 items-center`} href={`${base}/card`}>Records card</Link>
        {o.consent && <span className="text-[13px] text-muted">Last consent {formatDateIN(o.consent.recordedAt.toISOString())}</span>}
      </div>
    </Panel>
  )

  return (
    <div className="grid gap-5 py-5">
      {p.deceased && <Notice tone="conflict" title="Recorded as deceased">Patient and caregiver access is closed.</Notice>}
      {p.disclosure !== 'cleared' && (
        <Notice title="Use neutral wording with the patient and family">
          Disclosure is {p.disclosure === 'unknown' ? 'unknown' : 'not cleared'}. Anything the patient or family sees (messages, the card, printed sheets) avoids diagnosis words; staff screens show everything.
        </Notice>
      )}

      {doctor ? (
        <>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <Panel feature title="Record status" icon={<FolderOpen />} id="status" aside={canRecords ? <Link href={`${base}/records`} className={`${linkCls} text-sm`}>Open all records</Link> : undefined}>
              <div className="flex flex-col items-center gap-5 sm:flex-row" data-tour="first-look">
                <Ring
                  label={`${o.docTotal} papers in the file and ${heldN} held for a person to check`}
                  parts={[{ label: 'In file', value: o.docTotal, tone: 'setu' }, { label: 'Held to check', value: heldN, tone: 'conflict' }]}
                  center={o.docTotal}
                  caption="papers in file"
                />
                <Legend items={[
                  { label: 'In file', value: o.docTotal, tone: 'setu', href: canRecords ? `${base}/records` : undefined },
                  { label: 'Held for a person to check', value: heldN, tone: 'conflict', href: `${base}/documents` },
                  { label: 'Mentioned but not in file', value: count('missing'), tone: 'unverified', dashed: true, href: `${base}/completeness` },
                  { label: sealed ? 'New since the last sealed visit' : 'Items on file, none sealed yet', value: count('new'), tone: 'patient', dashed: true, href: `${base}/ledger` },
                  { label: 'Items not yet checked', value: count('unverified'), tone: 'verified', dashed: true, href: `${base}/ledger` },
                ]} />
              </div>
            </Panel>
            <Panel tint title="Next actions" icon={<Sparkles />} id="next">
              <ActionList items={actions} empty="Nothing is waiting on this record." />
            </Panel>
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            {isEmptyOncology(doctor.oncology)
              ? <Panel title="Record at a glance" icon={<FolderOpen />} id="glance-empty"><p className="text-[15px] text-muted">Nothing has been read from the papers yet.</p></Panel>
              : <RecordGlance v={doctor.oncology} />}
            <div className="grid gap-5">
              <Panel tint title={sealed ? 'Since the last visit' : 'On file so far'} icon={<CalendarRange />} id="since">
                <Checklist items={[
                  count('new')
                    ? { state: 'done', title: `${count('new')} ${sealed ? 'new items since the visit was sealed' : 'items on file'}`, detail: sealed ? undefined : 'No visit has been sealed yet', href: `${base}/ledger` }
                    : { state: 'clear', title: sealed ? 'Nothing new since the last visit' : 'Nothing on file yet' },
                  count('conflicts')
                    ? { state: 'attention', title: `${count('conflicts')} ${count('conflicts') === 1 ? 'source disagrees' : 'sources disagree'}`, detail: 'Both quotes are shown; a clinician decides', href: `${base}/ledger#conflicts` }
                    : { state: 'clear', title: 'No sources disagree' },
                  heldN
                    ? { state: 'attention', title: `${heldN} ${heldN === 1 ? 'paper' : 'papers'} held: check and resolve`, href: `${base}/documents` }
                    : { state: 'clear', title: 'Nothing held' },
                ]} />
              </Panel>
              {visitSealed && (
                <p className="text-[15px] text-muted" data-testid="study-form-link">
                  This visit is sealed.{' '}
                  <Link className={linkCls} href={`/measure?visit=${o.encounter!.id}`}>Fill the 1-minute study form</Link>
                </p>
              )}
              {visit}
            </div>
          </div>

          {milestones.length > 0 && (
            <Panel title="Care so far, from the papers" icon={<CalendarRange />} id="care" aside={tabAllowed('timeline', role) ? <Link href={`${base}/timeline`} className={`${linkCls} text-sm`}>Open the timeline</Link> : undefined}>
              <MilestoneLine items={milestones} label="Dated care milestones, oldest first" />
              <p className="text-[13px] text-muted">Only what the papers say happened, with its date. Nothing is inferred about what should come next.</p>
            </Panel>
          )}

          {role !== 'clinician' && setup}
        </>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {setup}
          {visit}
        </div>
      )}
    </div>
  )
}
