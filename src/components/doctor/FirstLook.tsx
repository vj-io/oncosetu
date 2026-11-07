import Link from 'next/link'
import { ArrowUpRight, CircleCheck, FilePlus2, FileX, ShieldCheck, TriangleAlert, UserX, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { EXPLAIN, Explainer, TONE } from '@/components/ui'
import type { FirstLookRow } from '@/core/doctor/first-look'

const ICON: Record<FirstLookRow['key'], LucideIcon> = {
  new: FilePlus2, missing: FileX, held: UserX, conflicts: TriangleAlert, unverified: CircleCheck, sealed: ShieldCheck,
}

/** The first thing a clinician sees on a patient: six rows, each one click from its detail. Counts and quotes only. */
export function FirstLook({ rows }: { rows: FirstLookRow[] }) {
  return (
    <section aria-labelledby="first-look-h" data-tour="first-look" className="grid gap-4 border border-rule bg-surface p-4 shadow-placard sm:p-6">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="first-look-h" className="text-2xl tracking-[-0.02em]">First look</h2>
          <p className="ds-kicker">Document index, not a clinical summary</p>
        </div>
        <Explainer>{EXPLAIN.firstLook}</Explainer>
      </header>
      <ul className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => {
          const Icon = ICON[r.key]
          const t = TONE[r.tone]
          return (
            <li key={r.key} className={clsx('grid content-start gap-2 border border-l-[3px] border-rule bg-matte px-4 py-3', t.bar)}>
              <div className="flex items-start gap-3">
                <Icon aria-hidden className={clsx('mt-0.5 size-5 shrink-0', t.text)} />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    {r.count !== null && <span className="font-display text-2xl leading-none tabular-nums">{r.count}</span>}
                    <span className="text-[15px] font-medium">{r.label}</span>
                  </p>
                  <p className="text-[14px] text-muted">{r.summary}</p>
                </div>
              </div>
              {r.details.length > 0 && (
                <ul className="grid gap-1.5 border-t border-rule pt-2 pl-8 text-[14px]">
                  {r.details.map((d, i) => (
                    <li key={i} className="grid gap-0.5">
                      {d.href ? <Link href={d.href} className="w-fit text-ink underline decoration-brass underline-offset-4">{d.text}</Link> : <span>{d.text}</span>}
                      {d.meta && <span className="text-[13px] text-muted">{d.meta}</span>}
                      {d.quote && <q className="font-display text-[15px] leading-snug text-ink">{d.quote}</q>}
                    </li>
                  ))}
                </ul>
              )}
              <Link href={r.href} className="inline-flex min-h-9 w-fit items-center gap-0.5 pl-8 text-sm text-setu-ink underline decoration-brass underline-offset-4">
                {r.linkLabel}<ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
