import Link from 'next/link'
import clsx from 'clsx'
import {
  ArrowUpRight, CalendarClock, Check, ChevronRight, CircleDashed, Dna, Info, Layers, Microscope, Pill, Scissors, ShieldAlert, Syringe, type LucideIcon,
} from 'lucide-react'
import { SourceWords } from '@/components/ledger/LedgerItem'
import { Badge, TONE, type Milestone, type Tone } from '@/components/ui'
import type { Fact, OncologyView } from '@/core/doctor/oncology'
import { dedupeFacts, newestFirst, quoteBelow } from './facts'

/* The clinician's patient dashboard: four summary tiles, the record at a glance, what is new, and the next steps. Counts and quotes only. */

const SECTIONS: { key: keyof OncologyView; title: string; icon: LucideIcon; tone: Tone; newest?: boolean }[] = [
  { key: 'diagnosis', title: 'Diagnosis', icon: Microscope, tone: 'patient' },
  { key: 'stage', title: 'Stage', icon: Layers, tone: 'shadow' },
  { key: 'markers', title: 'Markers', icon: Dna, tone: 'patient' },
  { key: 'margins', title: 'Margins', icon: Scissors, tone: 'shadow' },
  { key: 'treatment', title: 'Treatment', icon: Syringe, tone: 'setu', newest: true },
  { key: 'medicines', title: 'Medicines', icon: Pill, tone: 'unverified' },
  { key: 'allergies', title: 'Allergies', icon: ShieldAlert, tone: 'conflict' },
  { key: 'followUp', title: 'Follow-up', icon: CalendarClock, tone: 'verified', newest: true },
]

function Meta({ f }: { f: Fact }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-muted">
      <span>{f.dateLabel}</span>
      {f.where && <span className="min-w-0 truncate">{f.where}</span>}
      {f.verified
        ? <span className="inline-flex items-center gap-1 text-sage-ink"><Check aria-hidden className="size-3.5" />Checked</span>
        : <span className="inline-flex items-center gap-1"><CircleDashed aria-hidden className="size-3.5" />Not yet checked</span>}
    </p>
  )
}

/** A full line: the words, the quote they came from, and the link to the page. */
function FactLine({ f }: { f: Fact }) {
  const quote = quoteBelow(f)
  return (
    <div className="grid min-w-0 gap-1">
      <p className="text-[15px] leading-snug break-words"><SourceWords quoted={f.quoted}>{f.text}</SourceWords></p>
      {quote && <q className="text-[14px] leading-snug text-muted">{quote}</q>}
      <Meta f={f} />
      {f.href && <Link href={f.href} className="inline-flex min-h-8 w-fit items-center gap-0.5 text-[13px] font-medium text-setu-ink underline decoration-link underline-offset-4">Show the exact words<ArrowUpRight aria-hidden className="size-3.5" /></Link>}
    </div>
  )
}

/** One row per part of the record, in the order a cancer record is read. The newest line shows; the rest open below it. */
export function RecordGlance({ v }: { v: OncologyView }) {
  const shown = SECTIONS.filter((s) => v[s.key].length > 0)
  const empty = SECTIONS.filter((s) => v[s.key].length === 0)
  return (
    <section aria-labelledby="glance-h" data-tour="oncology" className="grid content-start rounded-xl border border-rule bg-surface shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 pb-2 sm:px-6">
        <div className="grid gap-0.5">
          <h2 id="glance-h" className="text-lg">Record at a glance</h2>
          <p className="text-[13px] text-muted">Copied word for word from the papers. OncoSetu does not decide or check the diagnosis.</p>
        </div>
        <Badge icon={<Info />}>Not a clinical summary</Badge>
      </header>
      <ul className="divide-y divide-rule px-3 pb-2 sm:px-4">
        {shown.map((s) => {
          const all = dedupeFacts(s.newest ? newestFirst(v[s.key]) : v[s.key])
          const Icon = s.icon
          const [lead, ...rest] = all
          return (
            <li key={s.key} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-x-3 px-2 py-3 sm:grid-cols-[2.25rem_8.5rem_minmax(0,1fr)_auto]">
              <span aria-hidden className={clsx('grid size-9 place-items-center rounded-sm', lead ? [TONE[s.tone].bg, TONE[s.tone].text] : 'bg-alcove text-faint')}><Icon className="size-[18px]" /></span>
              <h3 className="pt-1.5 text-[15px] font-semibold">{s.title}</h3>
              <div className="col-start-2 row-start-2 grid min-w-0 gap-1 sm:col-start-3 sm:row-start-1 sm:pt-1">
                {lead ? (
                  <>
                    <p className="line-clamp-2 text-[15px] leading-snug font-medium break-words"><SourceWords quoted={lead.quoted}>{lead.text}</SourceWords></p>
                    <Meta f={lead} />
                  </>
                ) : <p className="text-[15px] text-muted">Nothing written on file</p>}
                {rest.length > 0 && (
                  <details className="group">
                    <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-sm font-medium text-setu-ink [&::-webkit-details-marker]:hidden">
                      <ChevronRight aria-hidden className="size-4 transition-transform group-open:rotate-90" />
                      {rest.length} more
                    </summary>
                    <div className="mt-1 grid gap-3 border-l-2 border-rule pl-3">{rest.map((f) => <FactLine key={f.id} f={f} />)}</div>
                  </details>
                )}
              </div>
              {lead?.href
                ? <Link href={lead.href} aria-label={`Show the exact words: ${s.title}`} className="col-start-3 row-start-1 grid size-11 place-items-center rounded-md text-muted hover:bg-spotlight hover:text-ink sm:col-start-4"><ChevronRight aria-hidden className="size-5" /></Link>
                : <span />}
            </li>
          )
        })}
      </ul>
      {empty.length > 0 && <p className="border-t border-rule px-5 py-3 text-[14px] text-muted sm:px-6" data-testid="onc-empty">Nothing written on file for: {empty.map((s) => s.title).join(', ')}.</p>}
    </section>
  )
}

/** Dated care milestones from the papers, oldest first: procedures, chemotherapy and radiotherapy, then the next follow-up date still to come. */
export function careMilestones(v: OncologyView, todayIso: string, patientId: string): Milestone[] {
  const KEEP = new Set(['Procedure or surgery', 'Chemotherapy', 'Radiotherapy'])
  const seen = new Set<string>()
  const done: Milestone[] = []
  for (const f of v.treatment) {
    if (!KEEP.has(f.kind) || !f.dateIso || f.dateIso > todayIso) continue
    const key = `${f.kind}|${f.dateIso}`
    if (seen.has(key)) continue
    seen.add(key)
    done.push({ title: f.kind === 'Procedure or surgery' ? 'Surgery or procedure' : f.kind, when: f.dateLabel, detail: f.text, state: 'done', href: f.href ?? `/patients/${patientId}/timeline` })
  }
  const next = v.followUp.filter((f) => f.dateIso && f.dateIso >= todayIso).sort((a, b) => (a.dateIso! < b.dateIso! ? -1 : 1))[0]
  const items = done.slice(-4)
  if (next) items.push({ title: 'Next date on file', when: next.dateLabel, detail: next.text, state: 'next', href: next.href ?? undefined })
  return items
}
