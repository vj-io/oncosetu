import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { patients } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { confirmPurpose, sendOtpTo } from '@/server/registration/confirm'
import { patientOwnTarget, primaryContactTarget } from '@/server/registration/contact'
import { fail, patientIdParam } from '@/server/registration/http'

// Starts an OTP that confirms a consent change (to the primary contact), or adding a caregiver / handing over control
// (to the patient's own phone, or the guardian's for a minor: a caregiver never confirms for themselves).
export const POST = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'], body: z.object({ target: z.enum(['primary', 'patient']) }),
}, async (ctx) => {
  const id = patientIdParam(ctx)
  const [p] = await ctx.db.select({ id: patients.id }).from(patients).where(eq(patients.id, id))
  if (!p) throw new HttpError(404, 'not_found', 'Not found')
  const target = ctx.body.target === 'primary' ? await primaryContactTarget(ctx.db, id) : await patientOwnTarget(ctx.db, id)
  const sent = await sendOtpTo(ctx.db, { orgId: ctx.session.orgId, patientId: id, target, purpose: confirmPurpose(id), templateKey: 'confirm.otp' })
  await ctx.audit('consent.otp_requested', 'patient', id, { outcome: sent, target: ctx.body.target })
  if (sent === 'no_phone') return fail(409, 'no_phone', 'There is no phone number to send a code to. Use in-person witnessed confirmation.')
  if (sent === 'locked') return fail(429, 'locked', 'Too many wrong codes. Try again in 15 minutes, or use in-person witnessed confirmation.')
  return { ok: true }
})
