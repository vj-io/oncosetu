import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { scheduleProcessing } from '@/server/pipeline/ingest'
import { documentStatus } from '@/server/pipeline/queries'
import { patientIdParam } from '@/server/registration/http'

/**
 * `{ status, stage, stages:[{key,state}], identity, flags }`. Polling drives progress: a queued or stale-locked document gets a runner.
 * Staff only: the raw document class and safety flags never go to a patient session (FR-CON-07); /p/upload does not poll this.
 */
export const GET = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'] }, async (ctx) => {
  const s = await documentStatus(ctx.db, patientIdParam(ctx))
  if (!s) throw new HttpError(404, 'not_found', 'Not found')
  await assertPatientAccess(ctx, s.doc.patientId)
  if (s.summary.needsRunner) scheduleProcessing(s.doc.id, s.doc.orgId)
  const { summary: d } = s
  return {
    id: d.id, status: d.status, stage: d.stage, stages: d.stages, docType: d.docType, events: d.events,
    identity: { result: d.identity, attachState: d.attachState }, flags: d.flags,
  }
})
