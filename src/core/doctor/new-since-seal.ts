// How many current items are not in the last sealed visit. Pure: the same rule the What's new page uses (an item is new when
// its id is not in the sealed copy), not a comparison of dates, because demo and imported records carry back-dated times.

export type SealedCopy = { verified: { id: string }[]; unverified: { id: string }[] }

export function countNewSinceSeal(eventIds: readonly string[], sealed: SealedCopy | null): number {
  if (!sealed) return eventIds.length
  const inSeal = new Set([...sealed.verified, ...sealed.unverified].map((e) => e.id))
  return eventIds.filter((id) => !inSeal.has(id)).length
}

/** Reads the sealed copy stored as JSON text; anything unreadable counts as "no usable seal" so nothing is hidden. */
export function parseSealedCopy(json: string | null | undefined): SealedCopy | null {
  if (!json) return null
  try {
    const v = JSON.parse(json) as Partial<SealedCopy>
    return Array.isArray(v.verified) && Array.isArray(v.unverified) ? { verified: v.verified, unverified: v.unverified } : null
  } catch {
    return null
  }
}

/**
 * The one "new" number every screen shows (tab badge, patients list, First look, What's new): what the What's new page lists as
 * new. Before any seal that is everything on file; after a seal it is the new items, the older papers that arrived late and the
 * corrected reports. Patient answers are counted separately.
 */
export function newItemTotal(v: { mode: 'initial' | 'diff'; events: { initial_record: readonly unknown[]; new_since_last_visit: readonly unknown[]; newly_received_older: readonly unknown[]; amended: readonly unknown[] } }): number {
  return v.mode === 'initial' ? v.events.initial_record.length : v.events.new_since_last_visit.length + v.events.newly_received_older.length + v.events.amended.length
}

/** Newest first by the date each item describes; undated last; equal dates keep their order. */
export function newestItemsFirst<T extends { when: { eventIso: string | null } }>(items: readonly T[]): T[] {
  return items.map((it, i) => ({ it, i })).sort((a, b) => {
    const x = a.it.when.eventIso, y = b.it.when.eventIso
    if (x === y) return a.i - b.i
    return x === null ? 1 : y === null ? -1 : x > y ? -1 : 1
  }).map((o) => o.it)
}

type AmendLike = { id: string; amends: { label: string; date: string | null; href: string | null; kind: 'addendum' | 'correction' } | null }

/** Lines from the same later paper shown once under it, not one card each (DOC-13). The first line decides the order. */
export function groupAmended<T extends AmendLike>(items: readonly T[]): { key: string; label: string; date: string | null; href: string | null; kind: 'addendum' | 'correction'; items: T[] }[] {
  const out = new Map<string, { key: string; label: string; date: string | null; href: string | null; kind: 'addendum' | 'correction'; items: T[] }>()
  for (const it of items) {
    const a = it.amends ?? { label: 'An earlier version', date: null, href: null, kind: 'correction' as const }
    const key = `${a.kind}|${a.href ?? a.label}|${a.date ?? ''}`
    const g = out.get(key) ?? { key, label: a.label, date: a.date, href: a.href, kind: a.kind, items: [] }
    g.items.push(it)
    out.set(key, g)
  }
  return [...out.values()]
}
