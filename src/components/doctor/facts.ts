// Small pure helpers for the clinician overview: no word is printed twice, and long lists fold. Nothing is reworded.
import type { Fact } from '@/core/doctor/oncology'

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** True when two strings say the same words (one holds the other, ignoring case, spacing and punctuation). */
export function sameWords(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = squash(a ?? ''), y = squash(b ?? '')
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}

/** The quote to print under a line, or null when the line already holds all of those words. */
export const quoteBelow = (f: Pick<Fact, 'text' | 'quote'>): string | null => (f.quote && !squash(f.text).includes(squash(f.quote)) ? f.quote : null)

/** The same words on the same date, from two papers or two readings, shown once (the first is kept; order is not changed). */
export function dedupeFacts<T extends Pick<Fact, 'text' | 'dateIso' | 'kind'>>(facts: readonly T[]): T[] {
  const seen = new Set<string>()
  return facts.filter((f) => {
    const k = `${f.kind}|${f.dateIso ?? ''}|${squash(f.text)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Newest first at the top: the first `n` are shown, the rest fold under "Show all". */
export function foldList<T>(items: readonly T[], n: number): { shown: T[]; rest: T[] } {
  return { shown: items.slice(0, n), rest: items.slice(n) }
}

/** "City Care Hospital, Nagpur" from a missing-paper line such as "Prescription the patient mentioned from City Care Hospital, Nagpur". */
export function placeFromWording(wording: string): string | null {
  const flat = wording.replace(/\s+/g, ' ').replace(/\s+(?:is|are)\s+not\s+in\s+(?:the\s+)?file\b.*$/i, '').replace(/\s*\(patient statement\)\s*$/i, '')
  const m = /\bfrom\s+(.{3,80}?)\s*[.]?\s*$/i.exec(flat)
  return m ? m[1] : null
}

/** Newest first, undated last; equal dates keep their order. */
export function newestFirst<T extends Pick<Fact, 'dateIso'>>(facts: readonly T[]): T[] {
  return facts.map((f, i) => ({ f, i })).sort((a, b) => {
    const x = a.f.dateIso, y = b.f.dateIso
    if (x === y) return a.i - b.i
    return x === null ? 1 : y === null ? -1 : x > y ? -1 : 1
  }).map((o) => o.f)
}
