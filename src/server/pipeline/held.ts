// One definition of "held" for every screen (REC-04): the Documents page, the patient Overview, First look and the records To do.
// Held = a file waiting for a person to say whose it is. Rejected, detached, blocked and still-being-read files are not held.
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { NOT_HELD_STATUS } from '@/core/held'
import { documents } from '@/db/schema'

export const isHeldDoc = and(eq(documents.attachState, 'pending_decision'), notInArray(documents.status, [...NOT_HELD_STATUS]))

/** A filed paper the reader found hard to read. Counted on its own, never inside "held". */
export const hardToReadDoc = and(inArray(documents.attachState, ['auto', 'attached']), eq(documents.status, 'needs_review'))
