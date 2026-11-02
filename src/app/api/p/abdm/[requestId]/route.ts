// The patient's (or acting caregiver's) answer to an ABDM consent request, standing in for the ABHA app (in-process
// consent manager): approve → artefact → transfer → decrypt after the consent gate → events; deny; revoke → erase.
import { z } from 'zod'
import { decideConsentRequest, eraseDue, revokeConsentRequest } from '@/server/abdm/flow'
import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'

export const POST = route({ auth: 'patient', body: z.object({ decision: z.enum(['approve', 'deny', 'revoke']) }) }, async (ctx) => {
  const requestId = patientIdParam(ctx, 'requestId')
  const c = { db: ctx.db, orgId: ctx.session.orgId, audit: ctx.audit }
  const patientId = ctx.session.patientId
  await eraseDue(c, patientId)
  return ctx.body.decision === 'revoke'
    ? revokeConsentRequest(c, patientId, requestId)
    : decideConsentRequest(c, patientId, requestId, ctx.body.decision)
})
