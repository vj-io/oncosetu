// Desk side of the optional ID check: stores the ID type, the LAST FOUR characters, who checked and when. A longer value is refused.
import { z } from 'zod'
import { ID_TYPE_LIST, validateLast4 } from '@/core/idcheck'
import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { recordIdVerification } from '@/server/privacy/privacy'
import { patientIdParam } from '@/server/registration/http'

export const POST = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'],
  body: z.object({ idType: z.enum(ID_TYPE_LIST), last4: z.string().max(40) }),
}, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess({ db: ctx.db, session: ctx.session }, patientId)
  const v = validateLast4(ctx.body.idType, ctx.body.last4)
  if (!v.ok) {
    await ctx.audit('id_verification.refused', 'patient', patientId, { reason: v.code, idType: ctx.body.idType }) // the value itself is never logged
    throw new HttpError(422, v.code === 'full_number' ? 'full_id_number_refused' : 'invalid_last4',
      v.code === 'full_number' ? 'Enter only the last 4 characters. Full ID numbers are never stored.' : 'Enter exactly the last 4 characters of the ID.')
  }
  const { id } = await recordIdVerification(ctx.db, { orgId: ctx.session.orgId, patientId, staffId: ctx.session.staffId, idType: ctx.body.idType, last4: v.last4 })
  await ctx.audit('id_verification.record', 'patient', patientId, { idType: ctx.body.idType, verificationId: id })
  return { ok: true }
})
