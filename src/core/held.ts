// The one rule for "held" (REC-04): a file waiting for a person to say whose it is. Rejected, detached, blocked and
// still-being-read files are not held. Pure, so the server queries (src/server/pipeline/held.ts) and the Documents page share it.
export const NOT_HELD_STATUS = ['queued', 'processing', 'quarantined'] as const

export const isHeldRow = (d: { attachState: string; status: string }) =>
  d.attachState === 'pending_decision' && !(NOT_HELD_STATUS as readonly string[]).includes(d.status)
