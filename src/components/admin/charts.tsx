import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { Tone } from '@/components/ui'

/* Small hand-written SVG charts. Every mark has its number printed beside it and an accessible name; colour is
   never the only carrier (labels, values and legends are text). No chart library. */

const FILL: Record<Tone, string> = {
  neutral: 'fill-ink', setu: 'fill-setu', verified: 'fill-sage', unverified: 'fill-amber', conflict: 'fill-madder',
  patient: 'fill-violet', shadow: 'fill-slate', brass: 'fill-brass',
}
const SWATCH: Record<Tone, string> = {
  neutral: 'bg-ink', setu: 'bg-setu', verified: 'bg-sage', unverified: 'bg-amber', conflict: 'bg-madder',
  patient: 'bg-violet', shadow: 'bg-slate', brass: 'bg-brass',
}

export type BarDatum = { label: ReactNode; text: string; value: number; of: number; value_text?: string; tone?: Tone }

/** One horizontal bar per row: label, bar (value of `of`), and the printed numbers. */
export function BarRows({ rows, label, className }: { rows: BarDatum[]; label: string; className?: string }) {
  return (
    <ul aria-label={label} className={clsx('grid gap-3', className)}>
      {rows.map((r, i) => {
        const pct = r.of > 0 ? Math.min(100, (r.value / r.of) * 100) : 0
        return (
          <li key={i} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
            <span className="text-sm leading-tight break-words">{r.label}</span>
            <svg role="img" aria-label={`${r.text}: ${r.value} of ${r.of}`} viewBox="0 0 100 10" preserveAspectRatio="none" className="h-3.5 w-full">
              <rect width="100" height="10" className="fill-alcove" />
              {pct > 0 && <rect width={pct} height="10" className={FILL[r.tone ?? 'setu']} />}
            </svg>
            <span className="min-w-20 text-right font-mono text-sm tabular-nums">{r.value_text ?? `${r.value} / ${r.of}`}</span>
          </li>
        )
      })}
    </ul>
  )
}

export type Segment = { label: string; value: number; tone: Tone }

/** One bar split into segments, with a legend that carries each count and share. */
export function StackedBar({ segments, label, className }: { segments: Segment[]; label: string; className?: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0)
  let x = 0
  return (
    <figure className={clsx('grid gap-3', className)}>
      <svg role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}, total ${total}`} viewBox="0 0 100 10" preserveAspectRatio="none" className="h-4 w-full">
        <rect width="100" height="10" className="fill-alcove" />
        {total > 0 && segments.map((s) => {
          const w = (s.value / total) * 100
          const mark = <rect key={s.label} x={x} width={w} height="10" className={FILL[s.tone]} />
          x += w
          return w > 0 ? mark : null
        })}
      </svg>
      <figcaption>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span aria-hidden className={clsx('size-2.5', SWATCH[s.tone])} />
              {s.label} <span className="font-mono tabular-nums">{s.value}</span>
              <span className="font-mono text-xs text-faint tabular-nums">{total ? `${Math.round((s.value / total) * 100)}%` : '—'}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}

/** A headline number with its definition's numerator and denominator spelled out. */
export function Stat({ label, value, detail, tone = 'neutral', className }: { label: string; value: ReactNode; detail?: ReactNode; tone?: Tone; className?: string }) {
  return (
    <div className={clsx('grid content-start gap-1.5 border border-l-[3px] border-rule bg-surface px-4 py-4 shadow-placard', tone === 'conflict' ? 'border-l-madder' : tone === 'verified' ? 'border-l-sage' : 'border-l-control', className)}>
      <p className="ds-kicker">{label}</p>
      <p className="font-display text-3xl tracking-[-0.03em] tabular-nums">{value}</p>
      {detail && <p className="text-sm text-muted">{detail}</p>}
    </div>
  )
}

/** Titled panel used by the metrics and measurement pages. */
export function Block({ kicker, title, note, children, className }: { kicker?: string; title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('grid grid-cols-1 content-start gap-4 bg-matte p-5 shadow-frame sm:p-6', className)}>
      <header className="grid gap-1">
        {kicker && <p className="ds-kicker">{kicker}</p>}
        <h2 className="text-xl leading-snug tracking-[-0.02em]">{title}</h2>
        {note && <p className="max-w-prose text-sm text-muted">{note}</p>}
      </header>
      {children}
    </section>
  )
}
