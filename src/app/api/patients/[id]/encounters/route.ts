// FR-OFF-02: a visit opened offline on a capture device, with the device's own UUIDv7, accepted when the queue syncs.
// Idempotent on that id: a retry after a lost response returns the same encounter. Records and clinicians only: the desk
// opens a visit by verifying the patient (FR-ID-02), and an offline visit never counts as that verification.
import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { encounters } from '@/db/schema'
import { assertDeviceActive } from '@/server/devices/check'
import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'

export const POST = route({
  auth: 'staff', roles: ['records', 'clinician'],
  body: z.object({ id: z.uuidv7(), clientCapturedAt: z.iso.datetime({ offset: true }).optional() }),
}, async (ctx) => {
  await assertDeviceActive(ctx.db, ctx.session.orgId, ctx.req.headers.get('x-device-id'))
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  const [{ n }] = await ctx.db.select({ n: count() }).from(encounters).where(eq(encounters.patientId, patientId))
  const [made] = await ctx.db.insert(encounters).values({
    id: ctx.body.id, orgId: ctx.session.orgId, patientId, type: n ? 'returning' : 'onboarding', startedBy: ctx.session.staffId,
    clientCapturedAt: ctx.body.clientCapturedAt ? new Date(ctx.body.clientCapturedAt) : null, offlineCreated: true, // started_at: server clock
  }).onConflictDoNothing({ target: encounters.id }).returning({ id: encounters.id })
  if (made) {
    await ctx.audit('encounter.started_offline', 'encounter', made.id, { patientId })
    return { id: made.id, created: true }
  }
  const [prev] = await ctx.db.select({ id: encounters.id }).from(encounters).where(and(eq(encounters.id, ctx.body.id), eq(encounters.patientId, patientId)))
  if (!prev) throw new HttpError(409, 'encounter_conflict', 'This visit id belongs to another record')
  return { id: prev.id, created: false }
})
