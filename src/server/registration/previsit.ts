// "Send pre-visit link": a neutral simulated SMS to the primary contact with the patient-portal login URL (J2).
import { eq } from 'drizzle-orm'
import { patients } from '@/db/schema'
import { registrationCopy } from '@/i18n/registration'
import { HttpError } from '../http'
import { sendMessage } from '../outbox'
import { assertPatientAccess } from '../patients'
import { primaryContactTarget } from './contact'
import { fail, type StaffCtx } from './http'

export async function sendPreVisitLink(ctx: StaffCtx<unknown>, patientId: string) {
  await assertPatientAccess(ctx, patientId) // consent (or break-glass) is checked on use
  const [p] = await ctx.db.select({ deceased: patients.deceased }).from(patients).where(eq(patients.id, patientId))
  if (!p) throw new HttpError(404, 'not_found', 'Not found')
  if (p.deceased) return fail(409, 'deceased', 'This patient is recorded as deceased')
  const target = await primaryContactTarget(ctx.db, patientId)
  if (!target) return fail(409, 'no_phone', 'No phone number is on file for the primary contact')
  const origin = ctx.req.headers.get('origin') // already matched to the host by the route wrapper
  const url = `${origin}/p/login?next=/p/visit` // after the code, straight to the pre-visit questions
  await sendMessage(ctx.db, {
    orgId: ctx.session.orgId, patientId, toPhone: target.phone, channel: 'sms', templateKey: 'previsit.link',
    body: registrationCopy.preVisitSms[target.lang](url), lang: target.lang,
  })
  await ctx.audit('patient.pre_visit_link_sent', 'patient', patientId, { toCaregiver: !!target.caregiverId })
  return { ok: true }
}
