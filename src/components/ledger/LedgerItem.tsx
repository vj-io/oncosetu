import Link from 'next/link'
import clsx from 'clsx'
import { ArrowUpRight, Eye } from 'lucide-react'
import { Badge, Placard, QuoteHighlight, StatusBadge } from '@/components/ui'
import type { EventFlag } from '@/core/types'
import type { ItemView, SourceView } from '@/server/ledger/core'
import { ItemActions } from './ItemActions'

const FLAG: Partial<Record<EventFlag, { label: string; tone: 'conflict' | 'unverified' | 'brass' | 'neutral' }>> = {
  conflict: { label: 'Conflict', tone: 'conflict' },
  low_confidence: { label: 'Low OCR confidence', tone: 'unverified' },
  binding_uncertain: { label: 'Binding uncertain', tone: 'unverified' },
  identity_warning: { label: 'Identity check', tone: 'unverified' },
  late_received: { label: 'Received late', tone: 'brass' },
  date_ambiguous: { label: 'Date ambiguous', tone: 'unverified' },
  date_unknown: { label: 'No date in source', tone: 'neutral' },
  date_future: { label: 'Date in future', tone: 'unverified' },
  patient_confirmed: { label: 'Patient confirmed', tone: 'neutral' },
}
const ROLE = { records: 'records officer', clinician: 'clinician' } as Record<string, string>
const SOURCE_TYPE: Record<string, string> = {
  external_document: 'Outside document', internal_document: 'This hospital', patient_reported: 'Patient said', caregiver_reported: 'Caregiver said',
  external_structured: 'ABDM record', clinician_entered: 'Clinician entered',
}
const METHOD: Record<string, string> = { text_layer: 'PDF text', ocr_llm: 'OCR', manual: 'Manual', structured_map: 'Structured', asr: 'Voice' }

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
              <Link href={s.href} className="inline-flex items-center gap-0.5 font-mono text-[11px] tracking-[0.12em] text-setu-ink uppercase underline decoration-brass underline-offset-4 hover:text-ink">
                Open source<ArrowUpRight aria-hidden className="size-3.5" />
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
      {shown.map((f) => (f === 'conflict' || f === 'low_confidence' || f === 'binding_uncertain' ? <StatusBadge key={f} status={f} /> : <Badge key={f} tone={FLAG[f]!.tone}>{FLAG[f]!.label}</Badge>))}
    </div>
  )
}

const KICKER: Record<ItemView['category'], string> = {
  initial_record: 'Initial record', new_since_last_visit: 'New since last visit', newly_received_older: 'Older record · newly received', amended: 'Amended · corrected',
}

/** One exhibit on the ledger wall: WHAT · WHERE · WHO · WHEN (FR-LED-04), with its actions. */
export function LedgerItem({ item, index = 0 }: { item: ItemView; index?: number }) {
  const older = item.category === 'newly_received_older'
  const acc = item.id.replace(/-/g, '').slice(-8).toUpperCase()
  const who = item.status === 'unverified'
    ? <span className="text-muted">Not yet verified · {item.tier === 'clinician' ? 'clinician' : 'records'} tier</span>
    : (
      <span>
        {item.statusLabel}
        {item.who.actorName && <> — {item.who.actorName}{item.who.role && <span className="text-muted"> ({ROLE[item.who.role] ?? item.who.role})</span>}</>}
        {item.who.at && <span className="font-mono text-[13px] text-muted"> · {item.who.at}</span>}
      </span>
    )
  const when = (
    <span className="grid gap-0.5">
      <span>
        <span className="ds-kicker mr-1.5">{item.when.dateFrom === 'document' ? 'Document date' : 'Event'}</span>
        {item.when.event}
        {item.when.dateFrom === 'document' && <span className="text-muted"> (no date in the quote)</span>}
      </span>
      <span className="font-mono text-[13px] text-muted">
        {item.when.document && item.when.dateFrom !== 'document' && <>Document {item.when.document} · </>}Received {item.when.received}
      </span>
    </span>
  )

  const card = (
    <Placard
      animate
      delay={Math.min(index * 40, 400)}
      className={clsx(older && 'border-l-[3px] border-l-brass')}
      kicker={<>{KICKER[item.category]} · {item.tier === 'clinician' ? 'Clinician tier' : 'Records tier'}</>}
      status={<StatusBadge status={item.status} />}
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
      accession={acc}
      // Pass only what the client island needs: the full ItemView (~16 KB) would be serialised into the RSC payload per card.
      footer={<ItemActions item={{
        id: item.id, rowVersion: item.rowVersion, status: item.status, permits: item.permits, editable: item.editable,
        viewedSource: item.viewedSource, typeLabel: item.typeLabel, sources: item.sources.filter((s) => s.href).slice(0, 1),
      }} />}
    >
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
