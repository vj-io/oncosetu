import Link from 'next/link'
import { ArrowUpRight, Check, CircleDashed } from 'lucide-react'
import { SourceWords } from '@/components/ledger/LedgerItem'
import { EXPLAIN, Explainer } from '@/components/ui'
import { isEmptyOncology, type Fact, type OncologyView } from '@/core/doctor/oncology'
import { dedupeFacts, foldList, newestFirst, quoteBelow } from './facts'

function FactRow({ f, showKind = false }: { f: Fact; showKind?: boolean }) {
  const quote = quoteBelow(f)
  return (
    <li className="grid gap-1 border-b border-rule py-2.5 last:border-b-0 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-4">
      <div className="grid content-start gap-0.5 text-[13px] text-muted">
        <span className="font-mono tracking-[0.04em]">{f.dateLabel}</span>
        {showKind && <span className="font-medium text-ink">{f.kind}</span>}
      </div>
      <div className="grid min-w-0 gap-1">
        <p className="text-[15px] leading-snug break-words"><SourceWords quoted={f.quoted}>{f.text}</SourceWords></p>
        {quote && <q className="font-display text-[15px] leading-snug text-muted">{quote}</q>}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          {f.verified
            ? <span className="inline-flex items-center gap-1 text-sage-ink"><Check aria-hidden className="size-3.5" />Checked against the page</span>
            : <span className="inline-flex items-center gap-1"><CircleDashed aria-hidden className="size-3.5" />Not yet checked</span>}
          {f.where && <span>{f.where}</span>}
          {f.href && <Link href={f.href} className="inline-flex min-h-8 items-center gap-0.5 text-setu-ink underline decoration-brass underline-offset-4">Show the exact words<ArrowUpRight aria-hidden className="size-3.5" /></Link>}
        </p>
      </div>
    </li>
  )
}

/** A section with facts: the newest few are shown, the rest fold under "Show all". An empty section never gets a box. */
function Block({ n, title, facts, showKind, keep = 1 }: { n: string; title: string; facts: Fact[]; showKind?: boolean; keep?: number }) {
  const { shown, rest } = foldList(facts, keep)
  return (
    <section aria-labelledby={`onc-${n}`} className="grid content-start gap-1 border border-rule bg-matte px-4 py-3">
      <h3 id={`onc-${n}`} className="flex items-baseline gap-2 text-lg tracking-[-0.015em]">
        <span className="font-mono text-xs tracking-[0.16em] text-faint">{n}</span>{title}
        <span className="ml-auto min-w-6 border border-rule bg-surface px-1.5 text-center font-mono text-xs text-muted tabular-nums">{facts.length}</span>
      </h3>
      <ul>{shown.map((f) => <FactRow key={f.id} f={f} showKind={showKind} />)}</ul>
      {rest.length > 0 && (
        <details>
          <summary className="min-h-9 w-fit cursor-pointer py-1.5 text-sm text-setu-ink underline decoration-brass underline-offset-4">Show all {facts.length}</summary>
          <ul>{rest.map((f) => <FactRow key={f.id} f={f} showKind={showKind} />)}</ul>
        </details>
      )}
    </section>
  )
}

/**
 * The record in the order a cancer record is read. Every line is a document's own words with a link to them, printed once.
 * A section with nothing in it folds into one line; when every section is empty nothing is drawn at all.
 */
export function OncologyFacts({ v }: { v: OncologyView }) {
  if (isEmptyOncology(v)) return null
  const sections: { n: string; title: string; facts: Fact[]; showKind?: boolean; keep?: number; wide?: boolean }[] = [
    { n: '01', title: 'Diagnosis and pathology', facts: dedupeFacts(v.diagnosis), wide: true },
    { n: '02', title: 'Stage, as written', facts: dedupeFacts(v.stage) },
    { n: '03', title: 'Marker results, as written', facts: dedupeFacts(v.markers) },
    { n: '04', title: 'Margins, as written', facts: dedupeFacts(v.margins) },
    { n: '05', title: 'Treatment, newest first', facts: dedupeFacts(newestFirst(v.treatment)), showKind: true, keep: 2, wide: true },
    { n: '06', title: 'Allergies', facts: dedupeFacts(v.allergies) },
    { n: '07', title: 'Medicines', facts: dedupeFacts(v.medicines) },
    { n: '08', title: 'Follow-up dates', facts: dedupeFacts(newestFirst(v.followUp)) },
  ]
  const full = sections.filter((s) => s.facts.length > 0)
  const empty = sections.filter((s) => s.facts.length === 0)
  return (
    <section aria-labelledby="onc-h" data-tour="oncology" className="grid gap-4">
      <header className="grid gap-2 border-b border-rule pb-3">
        <h2 id="onc-h" className="text-2xl tracking-[-0.02em]">The record, as written</h2>
        <Explainer>{EXPLAIN.oncology} {EXPLAIN.diagnosis}</Explainer>
      </header>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {full.map((s) => <div key={s.n} className={s.wide ? 'lg:col-span-2' : undefined}><Block n={s.n} title={s.title} facts={s.facts} showKind={s.showKind} keep={s.keep} /></div>)}
      </div>
      {empty.length > 0 && (
        <p className="text-[14px] text-faint" data-testid="onc-empty">
          Nothing written on file for: {empty.map((s) => s.title.replace(/, as written| ,.*$/, '').replace(/, newest first/, '')).join(' · ')}.
        </p>
      )}
    </section>
  )
}
