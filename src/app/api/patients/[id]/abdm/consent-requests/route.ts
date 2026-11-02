// J6: staff ask the patient (through the consent manager) for ABDM records. Needs consent purpose `abdm` and an ABHA number.
import { z } from 'zod'
import { HI_TYPES } from '@/core/fhir'
import { createConsentRequest } from '@/server/abdm/flow'
import { route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'

const body = z.object({ hiTypes: z.array(z.enum(HI_TYPES)).min(1).max(HI_TYPES.length), from: z.iso.date(), to: z.iso.date() })

export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body }, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  return createConsentRequest({
    db: ctx.db, orgId: ctx.session.orgId, audit: ctx.audit, staffId: ctx.session.staffId, origin: ctx.req.headers.get('origin'),
  }, patientId, ctx.body)
})
