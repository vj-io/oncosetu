import type { ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  ArrowUpRight, CalendarClock, Check, ChevronRight, CircleDashed, Dna, FilePlus2, FileX, Layers, ListChecks, Microscope, Pill,
  Scissors, ShieldAlert, Syringe, TriangleAlert, UserX, type LucideIcon,
} from 'lucide-react'
import { SourceWords } from '@/components/ledger/LedgerItem'
import { TONE, type Tone } from '@/components/ui'
import type { FirstLookRow } from '@/core/doctor/first-look'
import type { Fact, OncologyView } from '@/core/doctor/oncology'
import { dedupeFacts, newestFirst, quoteBelow } from './facts'

/* The clinician's patient dashboard: four summary tiles, the record at a glance, what is new, and the next steps. Counts and quotes only. */

const first = (s: string) => s.split(/(?<=\.)\s/)[0].replace(/\.$/, '')

const TILE: Partial<Record<FirstLookRow['key'], { icon: LucideIcon; tone: Tone; label: (r: FirstLookRow, sealed: boolean) => string; sub: (r: FirstLookRow, sealed: boolean) => string }>> = {
  new: { icon: FilePlus2, tone: 'setu', label: (_, sealed) => (sealed ? 'New since last visit' : 'Items on file'), sub: (r, sealed) => (r.count ? (sealed ? 'Since the last sealed visit' : 'No visit sealed yet') : first(r.summary)) },
  missing: { icon: FileX, tone: 'unverified', label: () => 'Missing papers', sub: (r) => first(r.summary) },
  held: { icon: UserX, tone: 'conflict', label: () => 'Held to check', sub: (r) => (r.count ? 'Name or writing unclear' : 'Nothing held') },
  unverified: { icon: ListChecks, tone: 'verified', label: () => 'Not yet checked', sub: (r) => (r.count ? 'Shown, but marked unchecked' : 'Everything checked') },
}

/** Four tiles, each one click from its detail. */
export function SummaryTiles({ rows }: { rows: FirstLookRow[] }) {
  const sealed = !/no visit sealed/i.test(rows.find((r) => r.key === 'new')?.label ?? 'no visit sealed')
  return (
    <ul data-tour="first-look" aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {(['new', 'missing', 'held', 'unverified'] as const).map((key) => {
        const r = rows.find((x) => x.key === key)
        const t = TILE[key]
        if (!r || !t) return null
        const Icon = t.icon
        return (
          <li key={key}>
            <Link href={r.href} className="group grid h-full content-start gap-2.5 rounded-lg border border-rule bg-surface p-4 shadow-card transition-colors hover:border-control/40 sm:p-5">
              <span aria-hidden className={clsx('grid size-9 place-items-center rounded-sm', TONE[t.tone].bg, TONE[t.tone].text)}><Icon className="size-[18px]" /></span>
              <span className="font-display text-[2rem] leading-none tabular-nums">{r.count ?? 0}</span>
              <span className="grid gap-0.5">
                <span className="text-[15px] font-semibold">{t.label(r, sealed)}</span>
                <span className="text-[13px] leading-snug text-muted">{t.sub(r, sealed)}</span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

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
  return (
    <section aria-labelledby="glance-h" data-tour="oncology" className="rounded-lg border border-rule bg-surface shadow-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-2 sm:px-5">
        <h2 id="glance-h" className="text-lg">Record at a glance</h2>
        <p className="text-[13px] text-muted">Copied word for word from the papers. OncoSetu does not decide or check the diagnosis.</p>
      </header>
      <ul className="divide-y divide-rule px-2 pb-2 sm:px-3">
        {SECTIONS.map((s) => {
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
    </section>
  )
}

/** The newest few items with their words, and a link to all of them. */
export function NewItems({ row }: { row: FirstLookRow }) {
  return (
    <section aria-labelledby="new-h" className="rounded-lg border border-rule bg-surface shadow-card">
      <header className="flex items-baseline justify-between gap-4 px-4 pt-4 pb-1 sm:px-5">
        <h2 id="new-h" className="text-lg">{/sealed/i.test(row.label) ? 'New since the last visit' : 'Latest on file'}</h2>
        {row.count ? <Link href={row.href} className="text-sm font-medium text-setu-ink underline decoration-link underline-offset-4">See all {row.count}</Link> : null}
      </header>
      {row.details.length ? (
        <ul className="divide-y divide-rule px-4 pb-2 sm:px-5">
          {row.details.map((d, i) => (
            <li key={i} className="grid gap-0.5 py-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
              <span className="text-[13px] text-muted sm:pt-0.5">{d.meta}</span>
              <span className="grid min-w-0 gap-0.5">
                {d.href ? <Link href={d.href} className="w-fit text-[15px] font-medium underline decoration-link underline-offset-4">{d.text}</Link> : <span className="text-[15px] font-medium">{d.text}</span>}
                {d.quote && <q className="line-clamp-2 text-[14px] text-muted">{d.quote}</q>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-4 text-[15px] text-muted sm:px-5">{row.summary}</p>
      )}
    </section>
  )
}

/** The rail's next steps: each a link with its count. Rows with nothing to do are left out. */
export function NextSteps({ rows, children }: { rows: FirstLookRow[]; children?: ReactNode }) {
  const STEP: Partial<Record<FirstLookRow['key'], { label: string; icon: LucideIcon; tone: Tone }>> = {
    conflicts: { label: 'Compare sources that disagree', icon: TriangleAlert, tone: 'conflict' },
    held: { label: 'Review held papers', icon: UserX, tone: 'conflict' },
    missing: { label: 'Ask for missing papers', icon: FileX, tone: 'unverified' },
    unverified: { label: 'Check items against the page', icon: ListChecks, tone: 'verified' },
  }
  const todo = (['conflicts', 'held', 'missing', 'unverified'] as const).map((k) => rows.find((r) => r.key === k)).filter((r): r is FirstLookRow => !!r && !!r.count)
  return (
    <section aria-labelledby="next-h" className="rounded-lg border border-rule bg-surface p-4 shadow-card">
      <h2 id="next-h" className="text-lg">Next steps</h2>
      {todo.length ? (
        <ul className="mt-3 grid gap-2">
          {todo.map((r) => {
            const st = STEP[r.key]!
            const Icon = st.icon
            return (
              <li key={r.key}>
                <Link href={r.href} className="flex min-h-12 items-center gap-3 rounded-md bg-alcove px-3 py-2 text-[15px] font-medium transition-colors hover:bg-floor">
                  <span aria-hidden className={clsx('grid size-8 shrink-0 place-items-center rounded-sm', TONE[st.tone].bg, TONE[st.tone].text)}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">{st.label}</span>
                  <span className="font-semibold tabular-nums">{r.count}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2 text-[15px] text-muted">Nothing is waiting on this record.</p>
      )}
      {children && <div className="mt-3 grid gap-2 border-t border-rule pt-3">{children}</div>}
    </section>
  )
}
