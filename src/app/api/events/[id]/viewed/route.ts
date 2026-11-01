import { eq } from 'drizzle-orm'
import { events } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'

/** FR-VER-03: the verifier opened this event's source. Audit action `event.source_viewed` (the Ledger reads it). */
export const POST = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) => {
  const [e] = await ctx.db.select({ id: events.id, patientId: events.patientId, documentId: events.documentId }).from(events).where(eq(events.id, patientIdParam(ctx)))
  if (!e) throw new HttpError(404, 'not_found', 'Not found')
  await assertPatientAccess(ctx, e.patientId)
  await ctx.audit('event.source_viewed', 'event', e.id, { documentId: e.documentId })
  return { ok: true }
})
