import { z } from 'zod'
import { normalizePhone } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { CONSENT_PURPOSE, sendOtpTo } from '@/server/registration/confirm'
import { fail } from '@/server/registration/http'
import { langSchema, phoneField } from '@/server/registration/schemas'

// Registration consent by OTP: sends a code to the primary contact's phone before the patient record exists.
export const POST = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'], body: z.object({ phone: phoneField, language: langSchema.default('en') }),
}, async (ctx) => {
  const phone = normalizePhone(ctx.body.phone)
  if (!phone) throw new HttpError(400, 'invalid_phone', 'Enter a valid phone number')
  const sent = await sendOtpTo(ctx.db, {
    orgId: ctx.session.orgId, patientId: null, target: { phone, lang: ctx.body.language, caregiverId: null },
    purpose: CONSENT_PURPOSE, templateKey: 'consent.otp',
  })
  await ctx.audit('consent.otp_requested', null, null, { outcome: sent })
  if (sent === 'locked') return fail(429, 'locked', 'Too many wrong codes. Try again in 15 minutes, or use in-person witnessed consent.')
  return { ok: true }
})
