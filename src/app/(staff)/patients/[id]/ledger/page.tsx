import { RoleRestricted } from '@/components/shell/RoleRestricted'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowUpRight, Copy } from 'lucide-react'
import { BrassSeal, Chip, EmptyFrame, EXPLAIN, Explainer, Frame, InfoTip, ProgressMeter, SectionHeader } from '@/components/ui'
import { ConflictCard } from '@/components/ledger/ConflictCard'
import { LedgerItem } from '@/components/ledger/LedgerItem'
import { LedgerToolbar } from '@/components/ledger/LedgerToolbar'
import { mergeNoAnswers } from '@/core/doctor/ledger-view'
import { now } from '@/server/clock'
import type { LedgerView } from '@/server/ledger/core'
import { loadLedger } from '@/server/ledger/record'
import { withPatientAccess } from '@/server/registration/page'
import { requireStaff } from '@/server/session'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata = { title: 'What’s new · OncoSetu' }

function Section({ id, n, title, count, description, children, empty, tip }: { id: string; n: string; title: string; count: number; description: string; children?: React.ReactNode; empty?: string; tip?: string }) {
  return (
    <section id={id} aria-labelledby={`sec-${id}`} className="grid scroll-mt-32 gap-5">
      <header className="grid gap-1 border-b border-rule pb-3">
        <div className="flex items-baseline gap-x-4">
          <span className="font-mono text-xs tracking-[0.16em] text-faint">{n}</span>
          <h2 id={`sec-${id}`} className="text-xl tracking-[-0.02em] sm:text-2xl">{title}</h2>
          <span className="min-w-6 border border-rule bg-matte px-1.5 text-center font-mono text-xs text-muted tabular-nums">{count}</span>
          {tip && <InfoTip>{tip}</InfoTip>}
        </div>
        <p className="max-w-3xl text-[15px] text-muted">{description}</p>
      </header>
      {count ? children : <p className="text-[15px] text-faint">{empty ?? 'None.'}</p>}
    </section>
  )
}

function SealPlaque({ v, patientId }: { v: LedgerView; patientId: string }) {
  const s = v.snapshot
  if (!s) {
    return (
      <div className="flex items-center gap-5">
        <span aria-hidden className="grid size-24 shrink-0 place-items-center rounded-full border-2 border-dashed border-control font-mono text-[10px] tracking-[0.16em] text-faint uppercase">Not sealed</span>
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
          <Link href={`/verify/${s.id}`} className="inline-flex items-center gap-0.5 text-setu-ink underline decoration-brass underline-offset-4">Check the seal<ArrowUpRight aria-hidden className="size-3.5" /></Link>
          <Link href={`/patients/${patientId}/timeline?asOf=${s.id}`} className="text-setu-ink underline decoration-brass underline-offset-4">See the record as it was then</Link>
          <InfoTip>{EXPLAIN.seal}</InfoTip>
        </p>
      </div>
    </div>
  )
}

function JumpBar({ items }: { items: { href: string; label: string; n: number }[] }) {
  return (
    <nav aria-label="Jump to a section" className="sticky top-16 z-20 -mx-4 overflow-x-auto border-y border-rule bg-gallery/95 px-4 backdrop-blur-sm sm:-mx-8 sm:px-8">
      <ul className="flex min-w-max gap-1">
        {items.map((i) => (
          <li key={i.href}>
            <a href={i.href} className="inline-flex h-11 items-center gap-2 px-3 text-sm whitespace-nowrap text-muted hover:text-ink">
              {i.label}<span className="min-w-6 border border-rule bg-matte px-1.5 text-center font-mono text-xs tabular-nums text-ink">{i.n}</span>
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
  const v = await withPatientAccess(id, async (tx, s) => loadLedger(tx, id, s, now(s.orgId)))
  if (!v) return null // the workspace layout explains the denial

  const items = Object.values(v.events).flat()
  const eligible = items.filter((i) => i.status === 'unverified' && i.bulk.eligible && i.permits.verify === true && i.viewedSource).map((i) => i.id)
  const total = v.counts.verified + v.counts.unverified + v.counts.disputed
  const sealedDay = v.snapshot ? v.snapshot.sealedLabel.split(',')[0] : ''
  const canAct = session.role !== 'desk'
  const initial = v.mode === 'initial'
  const said = mergeNoAnswers(v.patientSaid)
  const newCount = initial ? v.events.initial_record.length : v.events.new_since_last_visit.length + v.events.newly_received_older.length
  let n = 0
  const num = () => String(++n).padStart(2, '0')

  const jump = [
    { href: '#conflicts', label: 'Disagreements', n: v.conflicts.length },
    ...(initial ? [] : [{ href: '#amended', label: 'Corrected', n: v.events.amended.length }]),
    { href: '#missing', label: 'Not in file', n: v.missing.length },
    { href: '#new', label: initial ? 'On file' : 'New', n: newCount },
    { href: '#said', label: 'Patient said', n: v.patientSaid.length },
  ]

  return (
    <div className="grid gap-10 py-8">
      <div className="grid gap-6">
        <SectionHeader
          kicker="What’s new"
          title={initial ? 'Everything on file so far' : 'What changed since the last sealed visit'}
          description={initial
            ? 'Everything received so far, each with the words it came from. Check what you can; the first visit can be sealed with some items still unchecked, and they stay marked as unchecked.'
            : 'Each item shows what it is, where it is written, who checked it and when. Grouped by kind of change and ordered by date, never by importance.'}
          actions={canAct ? <LedgerToolbar patientId={id} eligibleIds={eligible} counts={v.counts} canSeal={session.role === 'clinician'} /> : undefined}
        />
        <Explainer>{EXPLAIN.ledger}</Explainer>
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_minmax(16rem,22rem)]">
          <SealPlaque v={v} patientId={id} />
          <ProgressMeter label="Checked against the page" value={v.counts.verified} max={Math.max(total, 1)} detail={`${v.counts.verified} of ${total}`} tone="verified" />
        </div>
        {!canAct && <Chip kicker="Desk" tone="shadow">Headline list only. Quotes and checking are for records staff and clinicians.</Chip>}
      </div>

      <JumpBar items={jump} />

      <Section id="conflicts" n={num()} title="Sources that disagree" count={v.conflicts.length} description="Two sources give different values for the same thing. Both quotes are shown side by side; a clinician decides." empty="No two sources disagree.">
        <div className="grid gap-5">{v.conflicts.map((c) => <ConflictCard key={c.key} c={c} />)}</div>
      </Section>

      {!initial && (
        <Section id="amended" n={num()} title="Corrected reports" count={v.events.amended.length} description="A later report that replaces an item in the last sealed visit. The original version is kept and can be compared." empty="No report has been corrected.">
          <div className="grid gap-5 lg:grid-cols-2">{v.events.amended.map((i, k) => <LedgerItem key={i.id} item={i} index={k} />)}</div>
        </Section>
      )}

      <Section id="missing" n={num()} title="Papers not in file" count={v.missing.length} tip={EXPLAIN.completeness} description="Papers that other papers mention but that we do not hold. Not in file does not mean it was not done." empty="No referred-to paper is missing.">
        <div className="grid gap-6 md:grid-cols-2">
          {v.missing.map((m, k) => (
            <EmptyFrame key={m.dedupeKey} animate delay={Math.min(k * 60, 400)} title={m.title} status={m.state === 'closed' || m.state === 'dismissed' ? 'expected' : m.state}
              action={<Link href={`/patients/${id}/completeness`} className="text-sm text-setu-ink underline decoration-brass underline-offset-4">Open the missing-papers checklist</Link>} />
          ))}
        </div>
      </Section>

      {initial ? (
        <Section id="new" n={num()} title="On file" count={v.events.initial_record.length} description="Listed by kind of document, with pathology and molecular reports first, then by date. Open a line to see the exact words." empty="Nothing received yet. Documents appear here once processed.">
          <div className="grid gap-2">{v.events.initial_record.map((i, k) => <LedgerItem key={i.id} item={i} index={k} collapsed />)}</div>
        </Section>
      ) : (
        <>
          <Section id="new" n={num()} title="New since the last visit" count={v.events.new_since_last_visit.length} description={`Dated after the visit sealed on ${sealedDay}. Open a line to see the exact words.`}>
            <div className="grid gap-2">{v.events.new_since_last_visit.map((i, k) => <LedgerItem key={i.id} item={i} index={k} collapsed />)}</div>
          </Section>
          <Section id="older" n={num()} title="Older papers that arrived late" count={v.events.newly_received_older.length} description="Dated on or before the last sealed visit but not part of it: older papers that arrived since. The date they describe comes first.">
            <div className="grid gap-2">{v.events.newly_received_older.map((i, k) => <LedgerItem key={i.id} item={i} index={k} collapsed />)}</div>
          </Section>
        </>
      )}

      <Section id="said" n={num()} title="Patient said" count={v.patientSaid.length} description="The patient’s or caregiver’s own words from the questions before the visit. Not yet backed by a document.">
        <div className="grid gap-4 md:grid-cols-2">
          {said.noLine && (
            <p className="border border-l-[3px] border-rule border-l-violet bg-matte px-5 py-3 text-[15px] md:col-span-2">
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
                <p className="font-mono text-[13px] text-muted">
                  {[s.medicines.length ? `Medicines: ${s.medicines.join(', ')}` : null, s.scans.length ? `Scans: ${s.scans.join(', ')}` : null, s.institution ? `Place: ${s.institution}` : null].filter(Boolean).join(' · ')}
                </p>
              )}
            </Frame>
          ))}
        </div>
      </Section>

      <Section id="duplicates" n={num()} title="Duplicates hidden" count={v.duplicates.count} description="Same kind, date and details as an item already listed, or from a duplicate document. The first one received is kept.">
        <details className="group border border-rule bg-surface">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-[15px]"><Copy aria-hidden className="size-4 text-faint" />Show the {v.duplicates.count} hidden {v.duplicates.count === 1 ? 'item' : 'items'}</summary>
          <ul className="grid divide-y divide-rule border-t border-rule">
            {v.duplicates.items.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-[15px]">
                <span>{d.typeLabel}{d.headline && <span className="text-muted"> · {d.headline}</span>}</span>
                <span className="font-mono text-[13px] text-muted">{d.docLabel} · {d.date}</span>
              </li>
            ))}
          </ul>
        </details>
      </Section>

      {v.mode === 'diff' && (
        <Section id="errata" n={num()} title="Removed after sealing" count={v.errata.length} description="Documents that were in the last sealed visit but have since been taken out as belonging to another patient. Their items are withdrawn from the record; the sealed copy itself is never altered.">
          <div className="grid gap-3">
            {v.errata.map((x) => (
              <Frame key={x.documentId} className="flex flex-wrap items-baseline justify-between gap-2 border-l-[3px] border-l-madder px-5 py-4">
                <span className="text-[15px]"><span className="ds-kicker mr-2 text-madder-ink">Removed</span>{x.docLabel}, taken out {x.detached}</span>
                <span className="font-mono text-[13px] text-muted">{x.withdrawn} {x.withdrawn === 1 ? 'item' : 'items'} withdrawn</span>
              </Frame>
            ))}
          </div>
        </Section>
      )}
      <span id="all" />
    </div>
  )
}
