import Link from 'next/link'
import { ArrowUpRight, GitCompare } from 'lucide-react'
import { SourceWords } from '@/components/ledger/LedgerItem'
import { Badge, Chip, StatusBadge, type Tone } from '@/components/ui'
import type { TimelineItem, TimelineView } from '@/server/ledger/core'

const LABEL_TONE: Record<TimelineItem['label'], Tone> = { Verified: 'verified', 'Not yet verified': 'unverified', Disputed: 'conflict' }

/** One placard hanging off the corridor rail: date, what, source chip, status, conflict marker, quote → source (FR-TML-02). */
function Hung({ i, k }: { i: TimelineItem; k: number }) {
  const s = i.sources.find((x) => x.href) ?? i.sources[0]
  return (
    <li className="relative pt-5">
      <span aria-hidden className="absolute top-1 left-1/2 h-4 w-px -translate-x-1/2 bg-control" />
      <span aria-hidden className="absolute top-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-ink" />
      <article className="ds-placard-in grid gap-3 border border-rule bg-surface px-4 py-4 shadow-placard sm:px-5" style={{ '--delay': `${Math.min(k * 35, 350)}ms` } as React.CSSProperties}>
        <header className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-mono text-[12px] tracking-[0.08em] text-muted uppercase">
            {i.dateLabel}
            {i.dateFrom === 'document' && <span className="normal-case tracking-normal"> · the document’s own date</span>}
          </p>
          <StatusBadge status={i.status} label={i.status === 'verified_matches_source' ? 'Checked against the page' : i.status === 'unverified' ? 'Not yet checked' : undefined} />
        </header>
        <h4 className="text-lg leading-snug tracking-[-0.015em]">
          {i.typeLabel}
          {i.headline && <span className="mt-0.5 block text-[15px] tracking-normal text-muted"><SourceWords quoted={i.quoted}>{i.headline}</SourceWords></span>}
        </h4>
        <div className="flex flex-wrap gap-1.5">
          <Chip kicker={i.label} tone={LABEL_TONE[i.label]}>{i.docLabel}{i.institution ? ` · ${i.institution}` : ''}</Chip>
          {i.conflict && <Badge tone="conflict" icon={<GitCompare />}>Sources disagree</Badge>}
          {i.flags.includes('low_confidence') && <Badge tone="unverified">Read from a photo: check the numbers</Badge>}
        </div>
        {s && (
          <div className="grid gap-1">
            {s.quote && <p className="line-clamp-3 border-l-2 border-brass pl-3 font-mono text-[13px] leading-relaxed">“<mark className="ds-quote">{s.quote}</mark>”</p>}
            {s.href && (
              <Link href={s.href} className="inline-flex w-fit items-center gap-0.5 text-[13px] text-setu-ink underline decoration-brass underline-offset-4">
                Show the exact words{s.pageNo != null && ` · p.${s.pageNo}`}<ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            )}
          </div>
        )}
      </article>
    </li>
  )
}

const RAIL = 'md:grid-cols-[7rem_2.5rem_minmax(0,1fr)]'

/** The gallery corridor: years and months marked on a rule line, placards hanging off it. A list underneath. */
export function Corridor({ view }: { view: TimelineView }) {
  return (
    <div className="grid gap-14">
      {view.years.length > 0 && (
        <div className="relative">
          <div aria-hidden className="absolute top-3 bottom-0 left-[5px] w-px bg-control md:left-[8.25rem]" />
          <ol className="grid gap-12">
            {view.years.map((y) => (
              <li key={y.year} className="grid gap-8">
                <div className={`relative grid items-center ${RAIL}`}>
                  <span aria-hidden className="absolute top-1/2 left-[5px] size-3 -translate-1/2 rotate-45 bg-ink md:left-[8.25rem]" />
                  <h2 className="pl-8 font-display text-5xl leading-none tracking-[-0.04em] text-ink md:col-start-1 md:pl-0 md:text-right">{y.year}</h2>
                </div>
                <ol className="grid gap-10">
                  {y.months.map((m) => (
                    <li key={m.key} className={`relative grid gap-3 ${RAIL}`}>
                      <span aria-hidden className="absolute top-2.5 left-[5px] h-px w-4 bg-ink md:left-[calc(8.25rem-0.5rem)]" />
                      <h3 className="ds-kicker pl-8 md:pt-1.5 md:pl-0 md:text-right">{m.label} {y.year}</h3>
                      <ol className="grid gap-x-5 gap-y-2 pl-8 md:col-start-3 md:pl-0 xl:grid-cols-2">
                        {m.items.map((i, k) => <Hung key={i.id} i={i} k={k} />)}
                      </ol>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </div>
      )}
      {view.undated.length > 0 && (
        <section aria-labelledby="undated" className="grid gap-4 border-t border-dashed border-control pt-8">
          <div>
            <h2 id="undated" className="text-2xl tracking-[-0.02em]">Undated</h2>
            <p className="text-[15px] text-muted">No date in the words quoted and none on the document. Kept in their own lane rather than guessed.</p>
          </div>
          <ol className="grid gap-x-5 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
            {view.undated.map((i, k) => <Hung key={i.id} i={i} k={k} />)}
          </ol>
        </section>
      )}
    </div>
  )
}
