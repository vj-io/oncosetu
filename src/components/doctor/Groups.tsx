import type { ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { ChevronRight, CircleAlert, CircleCheck, Sparkles } from 'lucide-react'
import { TONE, type Tone } from '@/components/ui'

/* Grouping pieces for the clinician pages (Overview, What's new, Missing papers, Patients): a labelled group, a summary strip,
   a "more" fold and a status checklist. Server-safe. Colour always comes with a word or a number. Rhythm: 12 px inside a card,
   20 px between cards in a group, 40 px between groups. */

const EDGE = 'border-edge'
const dot = (t: Tone) => (t === 'neutral' ? 'bg-control' : TONE[t].solid)

/** The count pill beside a group title. */
export const CountPill = ({ n }: { n: number }) => (
  <span className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-alcove px-2 text-[13px] leading-6 font-medium text-ink tabular-nums">{n}</span>
)

/** A labelled group: one heading, a one-line purpose, an optional count, then its cards. `id` names the heading. */
export function Band({ id, title, purpose, count, children, className }: { id: string; title: ReactNode; purpose?: ReactNode; count?: number; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-labelledby={id} className={clsx('grid gap-4', className)}>
      <header className={clsx('grid gap-1 border-b pb-3', EDGE)}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id={id} className="text-xl">{title}</h2>
          {count != null && <CountPill n={count} />}
        </div>
        {purpose && <p className="max-w-3xl text-[15px] text-muted">{purpose}</p>}
      </header>
      {children}
    </div>
  )
}

export type StripItem = { label: ReactNode; value: ReactNode; tone: Tone; sub?: ReactNode; href?: string }
const STRIP_COLS = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' } as const

/** One white card cut into cells (number over label, a dot in the meaning colour). A cell is a link when it has an href. */
export function SummaryStrip({ items, label, cols, className, tour }: { items: StripItem[]; label: string; cols: 3 | 4 | 5; className?: string; tour?: string }) {
  return (
    <ul aria-label={label} data-tour={tour} className={clsx('grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-rule shadow-card', EDGE, STRIP_COLS[cols], className)}>
      {items.map((it, k) => {
        const body = (
          <>
            <span className="flex items-center gap-2 text-[13px] font-semibold text-muted">
              <span aria-hidden className={clsx('size-2.5 shrink-0 rounded-full', dot(it.tone))} />
              <span className="min-w-0 flex-1">{it.label}</span>
              {it.href && <ChevronRight aria-hidden className="size-4 shrink-0 text-faint" />}
            </span>
            <span className="font-display text-[1.75rem] leading-none tabular-nums">{it.value}</span>
            {it.sub && <span className="text-[13px] leading-snug text-muted">{it.sub}</span>}
          </>
        )
        const cell = 'grid h-full min-h-11 content-start gap-1.5 bg-surface p-4'
        return (
          <li key={k} className="min-w-0 last:odd:col-span-2 lg:last:odd:col-span-1">
            {it.href ? <Link href={it.href} className={clsx(cell, 'hover:bg-spotlight focus-visible:-outline-offset-2')}>{body}</Link> : <div className={cell}>{body}</div>}
          </li>
        )
      })}
    </ul>
  )
}

/** A closed fold for what is read less often (explanations, long lists). Nothing in it is removed; it opens in one tap. */
export function More({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={clsx('group/more rounded-xl border bg-surface', EDGE, className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-medium text-setu-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 transition-transform group-open/more:rotate-90" />
        {summary}
      </summary>
      <div className={clsx('grid gap-3 border-t px-4 py-4', EDGE)}>{children}</div>
    </details>
  )
}

export type StatusState = 'attention' | 'info' | 'clear'
const ORDER: Record<StatusState, number> = { attention: 0, info: 1, clear: 2 }

/** A short status list. Attention rows come first (an alert icon on red), then new items (sparkle on teal), then what is clear (a green check, quiet text).
 *  A new item is something to review, so it never gets the green tick. */
export function StatusChecklist({ items }: { items: { state: StatusState; title: ReactNode; detail?: ReactNode; href?: string }[] }) {
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => ORDER[a.it.state] - ORDER[b.it.state] || a.i - b.i).map((x) => x.it)
  return (
    <ul className="grid gap-3">
      {sorted.map((it, k) => {
        const icon = it.state === 'attention'
          ? <span className="grid size-7 place-items-center rounded-full bg-madder-tint text-madder-ink"><CircleAlert className="size-4" /></span>
          : it.state === 'info'
            ? <span className="grid size-7 place-items-center rounded-full bg-setu-tint text-setu-ink"><Sparkles className="size-4" /></span>
            : <span className="grid size-7 place-items-center text-sage-ink"><CircleCheck className="size-5" /></span>
        const text = (
          <span className="grid gap-0.5">
            <span className={clsx('text-[15px]', it.state === 'clear' ? 'text-muted' : 'font-medium', it.href && 'underline decoration-link underline-offset-4')}>{it.title}</span>
            {it.detail && <span className="text-[13px] text-muted">{it.detail}</span>}
          </span>
        )
        return (
          <li key={k} className="flex items-start gap-3">
            <span aria-hidden className="shrink-0">{icon}</span>
            <span className="sr-only">{it.state === 'attention' ? 'Needs attention: ' : it.state === 'info' ? 'New: ' : 'Nothing to do: '}</span>
            {it.href ? <Link href={it.href} className="flex min-h-11 min-w-0 items-center">{text}</Link> : text}
          </li>
        )
      })}
    </ul>
  )
}
