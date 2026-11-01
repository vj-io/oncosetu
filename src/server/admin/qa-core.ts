// FR-VER-04: reproducible weekly 5% sample of records-verified items. Pure.
import { createHash } from 'node:crypto'

export const QA_RATE = 0.05
const rank = (verificationId: string) => createHash('sha256').update(`qa-v1:${verificationId}`).digest('hex')

/** ISO-8601 week key in UTC, e.g. "2026-W45". */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)) // Thursday of this week
  const w = Math.ceil(((+t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`
}

/**
 * Per ISO week, the ⌈5%·n⌉ items with the lowest SHA-256("qa-v1:" + id). Same items in → same sample out;
 * nobody (including the verifier) can steer which item is sampled. Returned newest first.
 */
export function selectQaSample<T extends { id: string; at: Date }>(items: readonly T[], rate = QA_RATE): (T & { week: string })[] {
  const byWeek = new Map<string, T[]>()
  for (const it of items) {
    const w = isoWeek(it.at)
    byWeek.set(w, [...(byWeek.get(w) ?? []), it])
  }
  const out: (T & { week: string })[] = []
  for (const [week, xs] of byWeek) {
    const k = Math.ceil(xs.length * rate)
    out.push(...xs.sort((a, b) => (rank(a.id) < rank(b.id) ? -1 : 1)).slice(0, k).map((x) => ({ ...x, week })))
  }
  return out.sort((a, b) => +b.at - +a.at)
}

export function disagreementRate(reviews: readonly { outcome: string }[]) {
  const disagree = reviews.filter((r) => r.outcome === 'disagree').length
  return { reviewed: reviews.length, disagree, rate: reviews.length ? disagree / reviews.length : null }
}

/** A second review must come from a different person than the original verifier. */
export const canSecondReview = (reviewerId: string, verifierId: string) => reviewerId !== verifierId
