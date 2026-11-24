import { RoleRestricted } from '@/components/shell/RoleRestricted'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowUpRight, Copy } from 'lucide-react'
import { BrassSeal, Chip, EmptyFrame, EXPLAIN, Explainer, Frame, InfoTip, Legend, Ring, SectionHeader, TONE, type Tone } from '@/components/ui'
import { Band, CountPill, More } from '@/components/doctor/Groups'
import { ConflictCard } from '@/components/ledger/ConflictCard'
import { LedgerItem, SourceWords } from '@/components/ledger/LedgerItem'
import { LedgerToolbar } from '@/components/ledger/LedgerToolbar'
import { mergeNoAnswers } from '@/core/doctor/ledger-view'
import { groupAmended, newItemTotal } from '@/core/doctor/new-since-seal'
import { writeAudit } from '@/server/audit'
import { now } from '@/server/clock'
import type { ItemView, LedgerView } from '@/server/ledger/core'
import { loadLedger } from '@/server/ledger/record'
import { withPatientAccess } from '@/server/registration/page'
import { requireStaff } from '@/server/session'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata = { title: 'What’s new · OncoSetu' }

/** One kind of change: a coloured edge, a title with its count and a one-line purpose, then the lines. Tight inside (12 px). */
function Section({ id, title, count, description, children, empty, tip, tone = 'neutral' }: { id: string; n: string; title: string; count: number; description: string; children?: React.ReactNode; empty?: string; tip?: string; tone?: Tone }) {
  return (
    <section id={id} aria-labelledby={`sec-${id}`} className={`grid scroll-mt-32 gap-3 border-l-[3px] pl-4 ${TONE[tone].bar}`}>
      <header className="grid gap-1">
        <div className="flex items-center gap-x-3">
          <h3 id={`sec-${id}`} className="text-lg">{title}</h3>
          <span data-count className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-alcove px-2 text-[13px] leading-6 font-medium text-ink tabular-nums">{count}</span>
          {tip && <InfoTip>{tip}</InfoTip>}
        </div>
        <p className="max-w-3xl text-[15px] text-muted">{description}</p>
      </header>
      {count ? children : <p className="text-[15px] text-muted">{empty ?? 'None.'}</p>}
    </section>
  )
}

const LIST = 'divide-y divide-rule overflow-hidden rounded-lg border border-control/30 bg-surface shadow-card'
const FIRST = 10

/** A list of lines: the first ten show, the rest open under "Show N more". Every line stays on the page. */
function Lines({ items, noun, render }: { items: ItemView[]; noun: string; render: (i: ItemView, k: number) => React.ReactNode }) {
  const head = items.slice(0, FIRST), rest = items.slice(FIRST)
  return (
    <div className="grid gap-3">
      <div className={LIST}>{head.map((i, k) => render(i, k))}</div>
      {rest.length > 0 && (
        <More summary={`Show ${rest.length} more ${noun}`}>
          <div className={LIST}>{rest.map((i, k) => render(i, FIRST + k))}</div>
        </More>
      )}
    </div>
  )
}

function SealPlaque({ v, patientId }: { v: LedgerView; patientId: string }) {
  const s = v.snapshot
  if (!s) {
    return (
      <div className="flex items-center gap-5">
        <span aria-hidden className="grid size-24 shrink-0 place-items-center rounded-full border-2 border-dashed border-control text-[13px] text-faint font-medium">Not sealed</span>
        <div className="grid gap-1">
          <p className="ds-kicker">First visit</p>
          <p className="max-w-md text-[15px] text-muted">No visit has been sealed yet. Items are listed by kind of document, starting with pathology and molecular reports. That is a filing order, not a measure of importance.</p>
        </div>
      </div>
    )
  }
  return (
    <div data-tour="seal" className="flex items-center gap-5">
      <BrassSeal code={s.sha256} label="Sealed" size={104} />
      <div className="grid gap-1">
        <p className="ds-kicker">Changes since the last sealed visit</p>
        <p className="text-[15px]">Sealed {s.sealedLabel}{s.signerName && <> by {s.signerName}</>}</p>
        <p className="flex flex-wrap items-center gap-x-4 text-sm">
          <Link href={`/verify/${s.id}`} className="inline-flex min-h-11 items-center gap-0.5 text-setu-ink underline decoration-link underline-offset-4">Check the seal<ArrowUpRight aria-hidden className="size-3.5" /></Link>
          <Link href={`/patients/${patientId}/timeline?asOf=${s.id}`} className="inline-flex min-h-11 items-center text-setu-ink underline decoration-link underline-offset-4">See the record as it was then</Link>
          <Link href={`/print/passport/${s.id}`} target="_blank" className="inline-flex min-h-11 items-center text-setu-ink underline decoration-link underline-offset-4">Print the passport</Link>
          <InfoTip>{EXPLAIN.seal}</InfoTip>
        </p>
      </div>
    </div>
  )
}

function JumpBar({ items }: { items: { href: string; label: string; n: number }[] }) {
  return (
    <nav aria-label="Jump to a section" className="sticky top-14 z-20 lg:top-16 -mx-4 overflow-x-auto border-y border-control/30 bg-surface/95 px-4 shadow-card backdrop-blur-sm sm:-mx-8 sm:px-8">
      <ul className="flex min-w-max gap-1">
        {items.map((i) => (
          <li key={i.href}>
            <a href={i.href} className="inline-flex h-11 items-center gap-2 px-3 text-sm whitespace-nowrap text-muted hover:text-ink">
              {i.label}<CountPill n={i.n} />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default async function LedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const session = await requireStaff()
  if (!['desk', 'records', 'clinician'].includes(session.role)) return <RoleRestricted roles={['desk', 'records', 'clinician']} role={session.role} backHref={`/patients/${id}/overview`} />
  const v = await withPatientAccess(id, async (tx, s) => {
    const v = await loadLedger(tx, id, s, now(s.orgId))
    // Start of the clinician review-time KPI (PRD §16.1, /admin/metrics); ids only.
    await writeAudit(tx, { orgId: s.orgId, actorId: s.staffId, actorRole: s.role, action: 'ledger.view', targetType: 'patient', targetId: id, details: { mode: v.mode } })
    return v
  })
  if (!v) return null // the workspace layout explains the denial

  const items = Object.values(v.events).flat()
  const eligible = items.filter((i) => i.status === 'unverified' && i.bulk.eligible && i.permits.verify === true && i.viewedSource).map((i) => i.id)
  const total = v.counts.verified + v.counts.unverified + v.counts.disputed
  const sealedDay = v.snapshot ? v.snapshot.sealedLabel.split(',')[0] : ''
  const canAct = session.role !== 'desk'
  const initial = v.mode === 'initial'
  const said = mergeNoAnswers(v.patientSaid)
  const newCount = initial ? v.events.initial_record.length : v.events.new_since_last_visit.length + v.events.newly_received_older.length
  const newTotal = newItemTotal(v)
  const amendedGroups = groupAmended(v.events.amended)
  let n = 0
  const num = () => String(++n).padStart(2, '0')

  const jump = [
    { href: '#conflicts', label: 'Disagreements', n: v.conflicts.length },
    { href: '#new', label: initial ? 'On file' : 'New', n: newCount },
    ...(initial ? [] : [{ href: '#amended', label: 'Corrected or added to', n: v.events.amended.length }]),
    { href: '#missing', label: 'Not in file', n: v.missing.length },
    { href: '#said', label: 'Patient said', n: v.patientSaid.length },
  ]

  return (
    // grid-cols-1 (minmax(0, 1fr)): an auto track grew to its widest child and pushed the full-bleed JumpBar 7 px past a phone screen
    <div className="grid grid-cols-1 gap-10 py-8">
      <div className="grid gap-5">
        <SectionHeader
          kicker="What’s new"
          title={initial ? 'Everything on file (first visit)' : 'What changed since the last sealed visit'}
          description={initial
            ? 'Everything received so far, each with the words it came from. Check what you can; the first visit can be sealed with some items still unchecked, and they stay marked as unchecked.'
            : 'Each item shows what it is, where it is written, who checked it and when. Grouped by kind of change and ordered by date, never by importance.'}
          actions={canAct ? <LedgerToolbar patientId={id} eligibleIds={eligible} counts={v.counts} canSeal={session.role === 'clinician'} /> : undefined}
        />
        <More summary="How to read this page"><Explainer>{EXPLAIN.ledger}</Explainer></More>
        {!initial && (
          <p className="text-[15px]" data-testid="new-total">
            <span className="font-medium">{newTotal} new in all</span>
            <span className="text-muted"> · {v.events.new_since_last_visit.length} new, {v.events.newly_received_older.length} older papers that arrived late, {v.events.amended.length} corrected or added to. Patient answers are listed separately.</span>
          </p>
        )}
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_minmax(20rem,26rem)]">
          <SealPlaque v={v} patientId={id} />
          <div className="flex items-center gap-4 rounded-xl border border-control/30 bg-surface p-4 shadow-card">
            <Ring
              size={112}
              label={`${v.counts.verified} of ${total} items checked against the page`}
              parts={[{ label: 'Checked', value: v.counts.verified, tone: 'verified' }, { label: 'Not yet checked', value: v.counts.unverified, tone: 'unverified' }, { label: 'Disputed', value: v.counts.disputed, tone: 'conflict' }]}
              center={total ? `${Math.round((v.counts.verified / total) * 100)}%` : '—'}
            />
            <Legend items={[
              { label: 'Checked against the page', value: v.counts.verified, tone: 'verified' },
              { label: 'Not yet checked', value: v.counts.unverified, tone: 'unverified' },
              { label: 'Disputed', value: v.counts.disputed, tone: 'conflict' },
            ]} />
          </div>
        </div>
        {!canAct && <Chip kicker="Desk" tone="shadow">Headline list only. Quotes and checking are for records staff and clinicians.</Chip>}
      </div>

      <JumpBar items={jump} />

      <Band id="review-h" title="To review first" purpose={initial ? 'Where two sources disagree, then everything on file. Open a line to see the exact words.' : 'Where two sources disagree, then what arrived since the last sealed visit, then reports that were corrected.'} className="gap-6">
        <div className="grid gap-8">
          <Section id="conflicts" n={num()} tone="conflict" title="Sources that disagree" count={v.conflicts.length} description="Two sources give different values for the same thing. Both quotes are shown side by side; a clinician decides." empty="No two sources disagree.">
            <div className="grid gap-5">{v.conflicts.map((c) => <ConflictCard key={c.key} c={c} />)}</div>
          </Section>

          {initial ? (
            <Section id="new" n={num()} tone="setu" title="On file" count={v.events.initial_record.length} description="Listed by kind of document, with pathology and molecular reports first, then by date. Open a line to see the exact words." empty="Nothing received yet. Documents appear here once processed.">
              <Lines items={v.events.initial_record} noun="lines" render={(i, k) => <LedgerItem key={i.id} item={i} index={k} collapsed desk={session.role === 'desk'} />} />
            </Section>
          ) : (
            <>
              <Section id="new" n={num()} tone="setu" title="New since the last visit" count={v.events.new_since_last_visit.length} description={`Dated after the visit sealed on ${sealedDay}. Open a line to see the exact words.`}>
                <Lines items={v.events.new_since_last_visit} noun="new lines" render={(i, k) => <LedgerItem key={i.id} item={i} index={k} collapsed desk={session.role === 'desk'} />} />
              </Section>
              <Section id="older" n={num()} tone="brass" title="Older papers that arrived late" count={v.events.newly_received_older.length} description="Dated on or before the last sealed visit but not part of it: older papers that arrived since. The date they describe comes first.">
                <Lines items={v.events.newly_received_older} noun="older lines" render={(i, k) => <LedgerItem key={i.id} item={i} index={k} collapsed desk={session.role === 'desk'} />} />
              </Section>
            </>
          )}

          {!initial && (
            <Section id="amended" n={num()} tone="brass" title="Corrected reports and addenda" count={v.events.amended.length} description="A later paper that adds to, or replaces, an item in the last sealed visit. The original is kept and can be opened to compare. An addendum adds words; it does not change what the original says." empty="No report has been corrected or added to.">
              <div className="grid gap-6">
                {amendedGroups.map((g) => (
                  <div key={g.key} className="grid gap-3" data-testid="amended-group">
                    <p className="text-[15px]">
                      <span className="ds-kicker mr-1.5">{g.kind === 'addendum' ? 'Addendum, adds to' : 'Replaces'}</span>
                      {g.label}{g.date && <span className="text-muted"> · {g.date}</span>}
                      <span className="text-muted"> · {g.items.length} {g.items.length === 1 ? 'line' : 'lines'}</span>
                      {g.href && <> · <Link href={g.href} className="inline-flex min-h-11 items-center text-setu-ink underline decoration-link underline-offset-4">Open the original to compare</Link></>}
                    </p>
                    <div className="grid gap-5 lg:grid-cols-2">{g.items.map((i, k) => <LedgerItem key={i.id} item={i} index={k} hideAmends />)}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </Band>

      <Band id="gaps-h" title="Gaps in the file" purpose="Papers that other papers mention but that we do not hold." className="gap-6">
        <Section id="missing" n={num()} tone="unverified" title="Papers not in file" count={v.missing.length} tip={EXPLAIN.completeness} description="Papers that other papers mention but that we do not hold. Not in file does not mean it was not done." empty="No referred-to paper is missing.">
          <div className="grid gap-5 md:grid-cols-2">
            {v.missing.map((m, k) => (
              <EmptyFrame key={m.dedupeKey} animate delay={Math.min(k * 60, 400)} title={m.title} status={m.state === 'closed' || m.state === 'dismissed' ? 'expected' : m.state}
                action={<Link href={`/patients/${id}/completeness`} className="inline-flex min-h-11 items-center text-sm text-setu-ink underline decoration-link underline-offset-4">Open the missing-papers checklist</Link>} />
            ))}
          </div>
        </Section>
      </Band>

      <Band id="also-h" title="Also on this record" purpose="The patient’s own words, hidden duplicates and papers taken out after sealing. Read less often." className="gap-6">
        <div className="grid gap-8">
          <Section id="said" n={num()} tone="patient" title="Patient said" count={v.patientSaid.length} description="The patient’s or caregiver’s own words from the questions before the visit. Not yet backed by a document.">
            <div className="grid gap-4 md:grid-cols-2">
              {said.noLine && (
                <p className="border border-l-[3px] border-rule border-l-violet bg-matte px-5 py-3 text-[15px] md:col-span-2 rounded-lg">
                  <span className="ds-kicker mr-2">Patient said</span>{said.noLine}
                </p>
              )}
              {said.rest.map((s, k) => (
                <Frame key={s.id} animate delay={Math.min(k * 40, 400)} className="grid gap-3 border-l-[3px] border-l-violet px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="ds-kicker">{s.question} · {s.captured}</p>
                    <Chip kicker="Patient said" tone="patient">{s.confirmed ? 'Confirmed by the patient' : 'Not confirmed'} · no document yet</Chip>
                  </div>
                  {s.transcript && <blockquote className="font-display text-lg leading-snug tracking-[-0.01em]">“{s.transcript}”</blockquote>}
                  {(s.medicines.length > 0 || s.scans.length > 0 || s.institution) && (
                    <p className="text-[13px] text-muted">
                      {[s.medicines.length ? `Medicines: ${s.medicines.join(', ')}` : null, s.scans.length ? `Scans: ${s.scans.join(', ')}` : null, s.institution ? `Place: ${s.institution}` : null].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </Frame>
              ))}
            </div>
          </Section>

          <Section id="duplicates" n={num()} title="Duplicates hidden" count={v.duplicates.count} description="Same kind, date and details as an item already listed, or from a duplicate document. The first one received is kept.">
            <details className="group rounded-lg border border-control/30 bg-surface">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-[15px]"><Copy aria-hidden className="size-4 text-faint" />Show the {v.duplicates.count} hidden {v.duplicates.count === 1 ? 'item' : 'items'}</summary>
              <ul className="grid divide-y divide-rule border-t border-rule">
                {v.duplicates.items.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-[15px]">
                    <span>{d.typeLabel}{d.headline && <span className="text-muted"> · <SourceWords quoted={d.quoted}>{d.headline}</SourceWords></span>}</span>
                    <span className="text-[13px] text-muted">{d.docLabel} · {d.date}</span>
                  </li>
                ))}
              </ul>
            </details>
          </Section>

          {v.mode === 'diff' && (
            <Section id="errata" n={num()} tone="conflict" title="Removed after sealing" count={v.errata.length} description="Documents that were in the last sealed visit but have since been taken out as belonging to another patient. Their items are withdrawn from the record; the sealed copy itself is never altered.">
              <div className="grid gap-3">
                {v.errata.map((x) => (
                  <Frame key={x.documentId} className="flex flex-wrap items-baseline justify-between gap-2 border-l-[3px] border-l-madder px-5 py-4">
                    <span className="text-[15px]"><span className="ds-kicker mr-2 text-madder-ink">Removed</span>{x.docLabel}, taken out {x.detached}</span>
                    <span className="text-[13px] text-muted">{x.withdrawn} {x.withdrawn === 1 ? 'item' : 'items'} withdrawn</span>
                  </Frame>
                ))}
              </div>
            </Section>
          )}
        </div>
      </Band>
      <span id="all" />
    </div>
  )
}
