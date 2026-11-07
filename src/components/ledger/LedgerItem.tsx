import Link from 'next/link'
import clsx from 'clsx'
import { ArrowUpRight, Eye } from 'lucide-react'
import { Badge, InfoTip, Placard, QuoteHighlight, StatusBadge } from '@/components/ui'
import type { EventFlag } from '@/core/types'
import type { ItemView, SourceView } from '@/server/ledger/core'
import { ItemActions } from './ItemActions'

const FLAG: Partial<Record<EventFlag, { label: string; tone: 'conflict' | 'unverified' | 'brass' | 'neutral'; tip?: string }>> = {
  conflict: { label: 'Sources disagree', tone: 'conflict' },
  low_confidence: { label: 'Read from a photo: check the numbers', tone: 'unverified', tip: 'The writing was read from a picture and some characters may be wrong. Compare the numbers with the page.' },
  binding_uncertain: { label: 'Check this is on the right line', tone: 'unverified', tip: 'The words are exact, but it is not certain which test or date they belong to. Open the page to be sure.' },
  identity_warning: { label: 'Name not fully matched', tone: 'unverified', tip: 'The name or details on the paper did not fully match this patient.' },
  late_received: { label: 'Arrived after the visit', tone: 'brass' },
  date_ambiguous: { label: 'Day and month could be swapped', tone: 'unverified', tip: 'The page does not make clear which number is the day, so both readings are shown until someone checks the page and picks one.' },
  date_unknown: { label: 'No date in the words quoted', tone: 'neutral' },
  date_future: { label: 'Date is in the future', tone: 'unverified' },
  patient_confirmed: { label: 'Patient confirmed', tone: 'neutral' },
}
const STATUS_WORDS: Record<string, string> = {
  unverified: 'Not yet checked', verified_matches_source: 'Checked against the page', edited: 'Corrected by a person (original kept)', rejected: 'Rejected', disputed: 'Disputed',
}
const ROLE = { records: 'records officer', clinician: 'clinician' } as Record<string, string>
const SOURCE_TYPE: Record<string, string> = {
  external_document: 'Outside document', internal_document: 'This hospital', patient_reported: 'Patient said', caregiver_reported: 'Caregiver said',
  external_structured: 'ABDM record', clinician_entered: 'Clinician entered',
}
const METHOD: Record<string, string> = { text_layer: 'read from the PDF text', ocr_llm: 'read from a photo', manual: 'typed by a person', structured_map: 'from a health record', asr: 'from a voice answer' }

export function Sources({ sources, compact = false }: { sources: SourceView[]; compact?: boolean }) {
  if (!sources.length) return <span className="text-muted">No source quote</span>
  return (
    <div className="grid gap-3">
      {sources.map((s, i) => (
        <div key={i} className="grid gap-1.5">
          <span className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
            {s.docLabel}
            {s.pageNo != null && <span className="font-mono text-[13px] text-muted">p.{s.pageNo}</span>}
            {s.href && (
              <Link href={s.href} className="inline-flex items-center gap-0.5 text-[13px] text-setu-ink underline decoration-brass underline-offset-4 hover:text-ink">
                Show the exact words<ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            )}
          </span>
          {s.quote && (
            <blockquote className={clsx('border-l-2 border-brass pl-3 font-mono leading-relaxed text-ink', compact ? 'text-[13px]' : 'text-[13.5px]')}>
              “<QuoteHighlight text={s.quote} start={0} end={s.quote.length} delay={200 + i * 120} />”
            </blockquote>
          )}
        </div>
      ))}
    </div>
  )
}

export function FlagBadges({ flags }: { flags: EventFlag[] }) {
  const shown = flags.filter((f) => FLAG[f])
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((f) => (
        <span key={f} className="inline-flex items-center gap-0.5">
          <Badge tone={FLAG[f]!.tone}>{FLAG[f]!.label}</Badge>
          {FLAG[f]!.tip && <InfoTip label="What this means">{FLAG[f]!.tip}</InfoTip>}
        </span>
      ))}
    </div>
  )
}

const KICKER: Record<ItemView['category'], string> = {
  initial_record: 'On file', new_since_last_visit: 'New since the last visit', newly_received_older: 'Older paper that arrived late', amended: 'Corrected report',
}

/** One exhibit on the ledger wall: WHAT · WHERE · WHO · WHEN (FR-LED-04), with its actions. */
export function LedgerItem({ item, index = 0, collapsed = false }: { item: ItemView; index?: number; collapsed?: boolean }) {
  if (collapsed) return <CollapsedItem item={item} index={index} />
  return <LedgerCard item={item} index={index} />
}

/** One line (date, kind, the document's words, status) that opens to the full card with its quote and actions. */
function CollapsedItem({ item, index }: { item: ItemView; index: number }) {
  const flags = item.flags.filter((f) => FLAG[f] && f !== 'late_received')
  return (
    <details id={`item-${item.id}`} className="group border border-rule bg-surface open:bg-transparent open:shadow-placard">
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="w-24 shrink-0 font-mono text-[13px] text-muted">{item.when.event}</span>
        <span className="min-w-0 flex-1 text-[15px]"><span className="font-medium">{item.typeLabel}</span>{item.headline && <span className="text-muted">: {item.headline}</span>}</span>
        <StatusBadge status={item.status} label={STATUS_WORDS[item.status]} />
        {flags.slice(0, 2).map((f) => <Badge key={f} tone={FLAG[f]!.tone}>{FLAG[f]!.label}</Badge>)}
        <span className="text-sm text-setu-ink underline decoration-brass underline-offset-4 group-open:hidden">Show quote</span>
        <span className="hidden text-sm text-setu-ink underline decoration-brass underline-offset-4 group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-rule p-3 sm:p-4"><LedgerCard item={item} index={index} /></div>
    </details>
  )
}

function LedgerCard({ item, index = 0 }: { item: ItemView; index?: number }) {
  const older = item.category === 'newly_received_older'
  const who = item.status === 'unverified'
    ? <span className="text-muted">Not yet checked{item.tier === 'clinician' ? ' · needs a doctor to verify' : ''}</span>
    : (
      <span>
        {STATUS_WORDS[item.status] ?? item.statusLabel}
        {item.who.actorName && <> by {item.who.actorName}{item.who.role && <span className="text-muted"> ({ROLE[item.who.role] ?? item.who.role})</span>}</>}
        {item.who.at && <span className="font-mono text-[13px] text-muted"> · {item.who.at}</span>}
      </span>
    )
  const when = (
    <span className="grid gap-0.5">
      <span>
        {item.when.event}
        {item.when.dateFrom === 'document' && <span className="text-muted"> (the document’s own date; the quoted words give none)</span>}
      </span>
      <span className="font-mono text-[13px] text-muted">
        Received {item.when.received}
      </span>
    </span>
  )

  const card = (
    <Placard
      animate
      delay={Math.min(index * 40, 400)}
      className={clsx(older && 'border-l-[3px] border-l-brass')}
      kicker={KICKER[item.category]}
      status={<StatusBadge status={item.status} label={STATUS_WORDS[item.status]} />}
      title={
        <>
          {item.typeLabel}
          {item.headline && <span className="mt-0.5 block text-base tracking-normal text-muted">{item.headline}</span>}
        </>
      }
      what={item.fields.length ? (
        <ul className="grid gap-0.5">
          {item.fields.map((f) => (
            <li key={f.key}>
              <span className="text-muted">{f.label}:</span> {f.value}
              {f.edited && <Badge tone="setu" className="ml-2 align-[2px]">Edited</Badge>}
            </li>
          ))}
        </ul>
      ) : undefined}
      where={item.sources.length ? <Sources sources={item.sources} /> : undefined}
      who={
        <span className="grid gap-1">
          {who}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tracking-[0.1em] text-faint uppercase">
            <span>{SOURCE_TYPE[item.provenance.sourceType] ?? item.provenance.sourceType} · {METHOD[item.provenance.method] ?? item.provenance.method}</span>
            {item.viewedSource && <span className="inline-flex items-center gap-1 text-sage-ink"><Eye aria-hidden className="size-3.5" />Source opened by you</span>}
            {item.version > 1 && <span>Version {item.version}</span>}
          </span>
        </span>
      }
      when={when}
      // Pass only what the client island needs: the full ItemView (~16 KB) would be serialised into the RSC payload per card.
      footer={<ItemActions item={{
        id: item.id, rowVersion: item.rowVersion, status: item.status, permits: item.permits, editable: item.editable,
        viewedSource: item.viewedSource, typeLabel: item.typeLabel, sources: item.sources.filter((s) => s.href).slice(0, 1), readings: item.when.readings,
      }} />}
    >
      {item.amends && (
        <p className="text-[15px]">
          <span className="ds-kicker mr-1.5">Replaces</span>
          {item.amends.label}{item.amends.date && <span className="text-muted"> · {item.amends.date}</span>}
          {item.amends.href && <> · <Link href={item.amends.href} className="text-setu-ink underline decoration-brass underline-offset-4">Open the original to compare</Link></>}
        </p>
      )}
      <FlagBadges flags={item.flags} />
    </Placard>
  )

  if (!older) return card
  // Newly received older records lead with their event date (FR-LED-02: visually distinct).
  return (
    <div className="grid gap-3 sm:grid-cols-[8.5rem_1fr] sm:gap-5">
      <div className="flex items-baseline gap-3 sm:block sm:pt-5 sm:text-right">
        <p className="font-display text-2xl leading-none tracking-[-0.02em] text-brass-ink sm:text-[1.7rem]">{item.when.event}</p>
        <p className="ds-kicker sm:mt-2">Received {item.when.received}</p>
      </div>
      {card}
    </div>
  )
}
