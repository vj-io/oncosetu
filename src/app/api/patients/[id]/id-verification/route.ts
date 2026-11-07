// Desk side of the optional ID check: stores the ID type, the LAST FOUR characters, who checked and when. A longer value is refused.
import { z } from 'zod'
import { ID_TYPE_LIST, validateLast4 } from '@/core/idcheck'
import { NextResponse } from 'next/server'
import { route } from '@/server/http'
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
    // The value itself is never logged. The refusal is returned (not thrown) so the audit row is committed with the request.
    await ctx.audit(v.code === 'full_number' ? 'identity.full_id_rejected' : 'identity.id_invalid', 'patient', patientId, { reason: v.code, idType: ctx.body.idType })
    return NextResponse.json({ error: {
      code: v.code === 'full_number' ? 'full_id_number_refused' : 'invalid_last4',
      message: v.code === 'full_number' ? 'Enter only the last 4 characters. Full ID numbers are never stored.' : 'Enter exactly the last 4 characters of the ID.',
    } }, { status: 422 })
  }
  const { id } = await recordIdVerification(ctx.db, { orgId: ctx.session.orgId, patientId, staffId: ctx.session.staffId, idType: ctx.body.idType, last4: v.last4 })
  await ctx.audit('id_verification.record', 'patient', patientId, { idType: ctx.body.idType, verificationId: id })
  return { ok: true }
})
