// Patient-level settings from the Consent & access tab: disclosure (FR-CON-07), primary contact, deceased (E-ID-11),
// handing control to a minor who turned 18 (E-ID-10), break-glass (FR-ID-10).
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { breakGlass, caregivers, patients, sessions } from '@/db/schema'
import { registrationCopy } from '@/i18n/registration'
import { now } from '../clock'
import { decryptField } from '../crypto'
import { HttpError } from '../http'
import { sendMessage } from '../outbox'
import { primaryContactTarget, patientPhoneTarget } from './contact'
import { confirmAction, confirmPurpose } from './confirm'
import { fail, type StaffCtx } from './http'
import { ageAt } from './logic'
import type { Confirm } from './schemas'

/** Disclosure changes carry a reason CODE (the audit log holds ids and enums only, never free text). */
export const DISCLOSURE_REASONS = [
  'patient_informed', 'patient_asked_not_to_be_told', 'family_request', 'clinician_assessment', 'status_recorded_in_error',
] as const
export const disclosureSchema = z.object({ status: z.enum(['cleared', 'not_cleared', 'unknown']), reason: z.enum(DISCLOSURE_REASONS) })

async function loadFor(ctx: StaffCtx<unknown>, patientId: string) {
  const [p] = await ctx.db.select().from(patients).where(eq(patients.id, patientId))
  if (!p) throw new HttpError(404, 'not_found', 'Not found')
  return p
}

export async function setDisclosure(ctx: StaffCtx<z.infer<typeof disclosureSchema>>, patientId: string) {
  const p = await loadFor(ctx, patientId)
  const { status, reason } = ctx.body
  if (status === p.disclosureStatus) return fail(409, 'unchanged', 'The disclosure status is already set to that value')
  await ctx.db.update(patients).set({
    disclosureStatus: status, disclosureSetBy: ctx.session.staffId, disclosureSetAt: new Date(), updatedAt: new Date(),
  }).where(eq(patients.id, patientId))
  await ctx.audit('patient.disclosure_changed', 'patient', patientId, { from: p.disclosureStatus, to: status, reason })
  return { ok: true, disclosure: status }
}

export async function setPrimaryContact(ctx: StaffCtx<{ primaryContact: 'patient' | 'caregiver' }>, patientId: string) {
  const p = await loadFor(ctx, patientId)
  const { primaryContact } = ctx.body
  if (p.minor && primaryContact === 'patient') return fail(409, 'minor_guardian', 'A patient under 18 is always contacted through the guardian')
  if (primaryContact === 'caregiver') {
    const [cg] = await ctx.db.select({ id: caregivers.id }).from(caregivers)
      .where(and(eq(caregivers.patientId, patientId), eq(caregivers.active, true), isNull(caregivers.revokedAt))).limit(1)
    if (!cg) return fail(409, 'no_caregiver', 'Add a caregiver with a phone number first')
  }
  if (primaryContact === 'patient' && !p.phoneEnc) return fail(409, 'no_patient_phone', 'The patient has no phone number on file')
  await ctx.db.update(patients).set({ primaryContact, updatedAt: new Date() }).where(eq(patients.id, patientId))
  await ctx.audit('patient.primary_contact_changed', 'patient', patientId, { from: p.primaryContact, to: primaryContact })
  return { ok: true, primaryContact }
}

/** Closes patient-facing access: sessions are refused on the next request and OTP login skips deceased patients. */
export async function setDeceased(ctx: StaffCtx<{ deceased: boolean }>, patientId: string) {
  const p = await loadFor(ctx, patientId)
  const { deceased } = ctx.body
  if (p.deceased === deceased) return { ok: true, deceased }
  await ctx.db.update(patients).set({ deceased, updatedAt: new Date() }).where(eq(patients.id, patientId))
  let ended = 0
  if (deceased) {
    ended = (await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.patientId, patientId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id })).length
  }
  await ctx.audit('patient.deceased_set', 'patient', patientId, { deceased, endedSessions: ended })
  return { ok: true, deceased }
}

/** E-ID-10: an adult whose record is still flagged minor takes control; guardian access ends. */
export async function transferControl(ctx: StaffCtx<{ confirm: Confirm }>, patientId: string) {
  const p = await loadFor(ctx, patientId)
  if (!p.minor) return fail(409, 'not_minor', 'This record is not flagged as a minor')
  const dob = p.dobEnc ? decryptField(p.dobEnc) : null
  if (!dob || ageAt(dob, await now(ctx.session.orgId)) < 18) return fail(409, 'still_minor', 'The patient is not yet 18')
  const c = await confirmAction(await patientPhoneTarget(ctx.db, patientId), confirmPurpose(patientId), ctx.body.confirm)
  if (!c.ok) return c.response
  const t = new Date()
  await ctx.db.update(patients).set({ minor: false, primaryContact: 'patient', updatedAt: t }).where(eq(patients.id, patientId))
  const guardians = await ctx.db.update(caregivers).set({ active: false, revokedAt: t })
    .where(and(eq(caregivers.patientId, patientId), eq(caregivers.isGuardian, true), eq(caregivers.active, true))).returning({ id: caregivers.id })
  for (const g of guardians) await ctx.db.update(sessions).set({ revokedAt: t }).where(and(eq(sessions.caregiverId, g.id), isNull(sessions.revokedAt)))
  await ctx.audit('patient.control_transferred', 'patient', patientId, { method: c.method, endedGuardians: guardians.length })
  return { ok: true, endedGuardians: guardians.length }
}

export const BREAK_GLASS_HOURS = 4
export const breakGlassSchema = z.object({ reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500) })

/**
 * Time-limited access outside consent. The org_admin alert is the break_glass row plus the audit row (staff have no
 * phone in the schema); the patient or primary contact gets a neutral simulated SMS.
 */
export async function grantBreakGlass(ctx: StaffCtx<z.infer<typeof breakGlassSchema>>, patientId: string) {
  const p = await loadFor(ctx, patientId)
  const s = ctx.session
  const expiresAt = new Date(Date.now() + BREAK_GLASS_HOURS * 3_600_000)
  const [bg] = await ctx.db.insert(breakGlass).values({ orgId: s.orgId, patientId, staffId: s.staffId, reason: ctx.body.reason, expiresAt }).returning({ id: breakGlass.id })
  const target = await primaryContactTarget(ctx.db, patientId)
  if (target) {
    await sendMessage(ctx.db, {
      orgId: s.orgId, patientId, toPhone: target.phone, channel: 'sms', templateKey: 'break_glass.notice',
      body: registrationCopy.breakGlassSms[p.preferredLanguage], lang: p.preferredLanguage,
    })
  }
  await ctx.audit('break_glass.granted', 'patient', patientId, { breakGlassId: bg.id, role: s.role, hours: BREAK_GLASS_HOURS, patientNotified: !!target })
  return { ok: true, id: bg.id, expiresAt: expiresAt.toISOString(), patientNotified: !!target }
}
