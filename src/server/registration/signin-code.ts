// "Give a sign-in code" (FR-ID-02, in person): staff show the primary contact a one-time patient-portal code on screen, so
// a patient can sign in on their own phone where no SMS provider is set up. Same code, lifetime, send budget and 5-try lock
// as an SMS code (otp.ts); only the delivery differs. The code goes to whoever signs in by phone (FR-CON-07 primary contact).
import { eq } from 'drizzle-orm'
import { patients } from '@/db/schema'
import { maskPhone, phoneHmac } from '../crypto'
import { HttpError } from '../http'
import { OTP_TTL_MS, startOtp } from '../otp'
import { assertPatientAccess } from '../patients'
import { primaryContactTarget } from './contact'
import { fail, type StaffCtx } from './http'

export async function issueSigninCode(ctx: StaffCtx<unknown>, patientId: string) {
  await assertPatientAccess(ctx, patientId) // consent (or break-glass) is checked on use
  const [p] = await ctx.db.select({ deceased: patients.deceased }).from(patients).where(eq(patients.id, patientId))
  if (!p) throw new HttpError(404, 'not_found', 'Not found')
  if (p.deceased) return fail(409, 'deceased', 'This patient is recorded as deceased')
  const target = await primaryContactTarget(ctx.db, patientId)
  const h = target ? phoneHmac(target.phone) : null
  if (!target || !h) return fail(409, 'no_phone', 'No phone number is on file for the primary contact. Add the patient’s number on the Consent & access tab (Caregivers and contact).')
  const toCaregiver = !!target.caregiverId
  const issued = await startOtp(h)
  if (!issued) {
    await ctx.audit('auth.signin_code_limited', 'patient', patientId, { toCaregiver })
    return fail(429, 'code_limited', 'Too many sign-in codes for this phone recently. Try again in 15 minutes.')
  }
  await ctx.audit('auth.signin_code_issued', 'patient', patientId, { toCaregiver })
  return { code: issued.code, phone: maskPhone(target.phone), toCaregiver, minutes: OTP_TTL_MS / 60_000 }
}
