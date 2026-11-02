// Pure parts of the FR-LED-07 production probe (src/app/api/cron/perf-probe/route.ts), kept apart so they are unit-tested
// (a route file may only export route fields).
export const BUDGET_MS = 2000
export const MIN_ITEMS = 500

/** Median; an even count averages the two middle values. NaN for an empty list (the verdict treats it as invalid). */
export function median(xs: number[]): number {
  if (!xs.length) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * One marker per ledger item: the exhibit card (`Placard`, src/components/ui/exhibit.tsx) is the only `<article>` carrying the
 * `shadow-placard` class on the ledger page (missing-record frames are articles without it). If that markup changes, the live
 * probe reports `invalid`, not a false pass, because the count drops below MIN_ITEMS.
 */
export const countItems = (html: string): number => (html.match(/<article\b[^>]*\bshadow-placard\b/g) ?? []).length

export type Verdict = 'pass' | 'fail' | 'invalid'

/** `totalMs` is the full-body time (the e2e spec's responseEnd - requestStart). Missing items or a bad response is `invalid`, never `pass`. */
export function verdictFor(i: { totalMs: number; itemsFound: number; httpOk: boolean }, budgetMs = BUDGET_MS, minItems = MIN_ITEMS): Verdict {
  if (!i.httpOk || !Number.isFinite(i.totalMs) || i.itemsFound < minItems) return 'invalid'
  return i.totalMs <= budgetMs ? 'pass' : 'fail'
}
