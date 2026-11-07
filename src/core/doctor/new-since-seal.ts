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
