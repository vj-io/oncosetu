import Link from 'next/link'
import { ArrowUpRight, Check, CircleDashed } from 'lucide-react'
import { SourceWords } from '@/components/ledger/LedgerItem'
import { EXPLAIN, Explainer } from '@/components/ui'
import type { Fact, OncologyView } from '@/core/doctor/oncology'

function FactRow({ f, showKind = false }: { f: Fact; showKind?: boolean }) {
  return (
    <li className="grid gap-1 border-b border-rule py-3 last:border-b-0 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4">
      <div className="grid content-start gap-0.5 text-[13px] text-muted">
        <span className="font-mono tracking-[0.04em]">{f.dateLabel}</span>
        {showKind && <span className="font-medium text-ink">{f.kind}</span>}
      </div>
      <div className="grid min-w-0 gap-1">
        <p className="text-[15px] leading-snug break-words"><SourceWords quoted={f.quoted}>{f.text}</SourceWords></p>
        {f.quote && f.quote !== f.text && <q className="font-display text-[15px] leading-snug text-muted">{f.quote}</q>}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          {f.verified
            ? <span className="inline-flex items-center gap-1 text-sage-ink"><Check aria-hidden className="size-3.5" />Checked against the page</span>
            : <span className="inline-flex items-center gap-1"><CircleDashed aria-hidden className="size-3.5" />Not yet checked</span>}
          {f.where && <span>{f.where}</span>}
          {f.href && <Link href={f.href} className="inline-flex items-center gap-0.5 text-setu-ink underline decoration-brass underline-offset-4">Show the exact words<ArrowUpRight aria-hidden className="size-3.5" /></Link>}
        </p>
      </div>
    </li>
  )
}

function Block({ n, title, facts, empty, showKind }: { n: string; title: string; facts: Fact[]; empty: string; showKind?: boolean }) {
  return (
    <section aria-labelledby={`onc-${n}`} className="grid content-start gap-1 border border-rule bg-matte px-4 py-3">
      <h3 id={`onc-${n}`} className="flex items-baseline gap-2 text-lg tracking-[-0.015em]">
        <span className="font-mono text-xs tracking-[0.16em] text-faint">{n}</span>{title}
        <span className="ml-auto min-w-6 border border-rule bg-surface px-1.5 text-center font-mono text-xs text-muted tabular-nums">{facts.length}</span>
      </h3>
      {facts.length ? <ul>{facts.map((f) => <FactRow key={f.id} f={f} showKind={showKind} />)}</ul> : <p className="py-2 text-[14px] text-faint">{empty}</p>}
    </section>
  )
}

/** The record in the order a cancer record is read. Every line is a document's own words with a link to them. */
export function OncologyFacts({ v }: { v: OncologyView }) {
  return (
    <section aria-labelledby="onc-h" data-tour="oncology" className="grid gap-4">
      <header className="grid gap-2 border-b border-rule pb-3">
        <h2 id="onc-h" className="text-2xl tracking-[-0.02em]">The record, as written</h2>
        <Explainer>{EXPLAIN.oncology} {EXPLAIN.diagnosis}</Explainer>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <Block n="01" title="Diagnosis and pathology" facts={v.diagnosis} empty="No diagnosis or pathology line in the documents on file." />
        <div className="grid content-start gap-4">
          <Block n="02" title="Stage, as written" facts={v.stage} empty="No stage is written in the documents on file." />
          <Block n="03" title="Marker results, as written" facts={v.markers} empty="No ER, PR, HER2, Ki-67 or other marker result is written in the documents on file." />
          <Block n="04" title="Margins, as written" facts={v.margins} empty="No margin sentence in the documents on file." />
        </div>
      </div>
      <Block n="05" title="Treatment, in date order" facts={v.treatment} showKind empty="No surgery, chemotherapy, radiotherapy or imaging documented yet." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Block n="06" title="Allergies" facts={v.allergies} empty="No allergy statement on file." />
        <Block n="07" title="Medicines" facts={v.medicines} empty="No prescription on file." />
        <Block n="08" title="Follow-up dates" facts={v.followUp} empty="No follow-up date written." />
      </div>
    </section>
  )
}
