import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { scheduleProcessing } from '@/server/pipeline/ingest'
import { documentStatus } from '@/server/pipeline/queries'
import { patientIdParam } from '@/server/registration/http'

/** `{ status, stage, stages:[{key,state}], identity, flags }`. Polling drives progress: a queued or stale-locked document gets a runner. */
export const GET = route({ auth: 'any' }, async (ctx) => {
  const s = await documentStatus(ctx.db, patientIdParam(ctx))
  if (!s) throw new HttpError(404, 'not_found', 'Not found')
  if (ctx.session.kind === 'staff' && !['desk', 'records', 'clinician'].includes(ctx.session.role)) throw new HttpError(403, 'forbidden', 'Not allowed')
  await assertPatientAccess(ctx, s.doc.patientId)
  if (s.summary.needsRunner) scheduleProcessing(s.doc.id, s.doc.orgId)
  const { summary: d } = s
  return {
    id: d.id, status: d.status, stage: d.stage, stages: d.stages, docType: d.docType, events: d.events,
    identity: { result: d.identity, attachState: d.attachState }, flags: d.flags,
  }
})
