// Patient-level settings from the Consent & access tab: disclosure (FR-CON-07), primary contact, deceased (E-ID-11),
// handing control to a minor who turned 18 (E-ID-10), break-glass (FR-ID-10).
import { and, eq, isNull, ne, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import { breakGlass, caregivers, documents, patientAliases, patients, sessions } from '@/db/schema'
import { registrationCopy } from '@/i18n/registration'
import { now } from '../clock'
import { decryptField, encryptField, hmac, maskPhone, normalizePhone, phoneHmac } from '../crypto'
import { scheduleBatch } from '../pipeline/ingest'
import { HttpError } from '../http'
import { sendMessage } from '../outbox'
import { assertPatientAccess } from '../patients'
import { primaryContactTarget, patientPhoneTarget, tellPatient } from './contact'
import { confirmAction, confirmPurpose } from './confirm'
import { fail, type StaffCtx } from './http'
import { ageAt, identityKey } from './logic'
import { personName, phoneField, type Confirm } from './schemas'

/** Disclosure changes carry a reason CODE (the audit log holds ids and enums only, never free text). */
export const DISCLOSURE_REASONS = [
  'patient_informed', 'patient_asked_not_to_be_told', 'family_request', 'clinician_assessment', 'status_recorded_in_error',
] as const
export const disclosureSchema = z.object({ status: z.enum(['cleared', 'not_cleared', 'unknown']), reason: z.enum(DISCLOSURE_REASONS) })

/** `guarded`: every patient-level change needs access to this patient; only break-glass (itself the way in) skips it. */
async function loadFor(ctx: StaffCtx<unknown>, patientId: string, guarded = true) {
  if (guarded) await assertPatientAccess(ctx, patientId)
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
  const patientNotified = p.primaryContact !== primaryContact
    && await tellPatient(ctx.db, { orgId: ctx.session.orgId, patientId, templateKey: 'primary_contact.changed', body: registrationCopy.primaryContactSms })
  await ctx.audit('patient.primary_contact_changed', 'patient', patientId, { from: p.primaryContact, to: primaryContact, patientNotified })
  return { ok: true, primaryContact }
}

/** Name changes carry a reason CODE (the audit log holds ids and enums only, never free text). */
export const NAME_REASONS = ['spelling_correction', 'married_or_legal_change', 'entered_in_error'] as const
export const patientNameSchema = z.object({ fullName: personName, reason: z.enum(NAME_REASONS), keepPrevious: z.boolean() })

/**
 * Clinician only. The old name can stay as another name, so papers written with it still match. Papers held for an identity
 * decision go back to the reading queue, where the pipeline checks them against the new name (a match attaches; otherwise
 * they stay held for a person).
 */
export async function setPatientName(ctx: StaffCtx<z.infer<typeof patientNameSchema>>, patientId: string) {
  const p = await loadFor(ctx, patientId)
  const next = ctx.body.fullName.trim().replace(/\s+/g, ' ')
  const prev = decryptField(p.nameEnc)
  if (next === prev) return fail(409, 'unchanged', 'This name is already on file')
  // The duplicate key uses the date of birth only when it was entered, not estimated from an age: keep that as it was.
  const dob = p.dobEnc ? decryptField(p.dobEnc) : null
  const realDob = dob && p.identityHmac === identityKey(prev, dob) ? dob : null
  await ctx.db.update(patients).set({ nameEnc: encryptField(next), identityHmac: identityKey(next, realDob), updatedAt: new Date() }).where(eq(patients.id, patientId))
  if (ctx.body.keepPrevious) {
    await ctx.db.insert(patientAliases).values({
      orgId: ctx.session.orgId, patientId, nameEnc: encryptField(prev), nameHmac: hmac(`alias:${prev}`),
      kind: ctx.body.reason === 'married_or_legal_change' ? 'married' : 'other', createdBy: ctx.session.staffId,
    })
  }
  const held = await ctx.db.update(documents).set({ status: 'queued', attempts: 0, updatedAt: new Date() }).where(and(
    eq(documents.patientId, patientId), eq(documents.attachState, 'pending_decision'), notInArray(documents.status, ['queued', 'processing', 'quarantined']),
  )).returning({ id: documents.id })
  await ctx.audit('patient.name_changed', 'patient', patientId, { reason: ctx.body.reason, keptPreviousAsOtherName: ctx.body.keepPrevious, heldRechecked: held.length })
  scheduleBatch(patientId, held.length, ctx.session.orgId)
  return { ok: true, heldRechecked: held.length }
}

/** The patient's own phone, added or changed with the patient in front of staff (witnessed; nothing can be texted to a number not yet on file). */
export const patientPhoneSchema = z.object({ phone: phoneField, confirm: z.object({ method: z.literal('witnessed'), attest: z.literal(true) }) })

export async function setPatientPhone(ctx: StaffCtx<z.infer<typeof patientPhoneSchema>>, patientId: string) {
  const p = await loadFor(ctx, patientId)
  if (p.deceased) return fail(409, 'deceased', 'This patient is recorded as deceased')
  const phone = normalizePhone(ctx.body.phone)
  const h = phone ? phoneHmac(phone) : null
  if (!phone || !h) return fail(400, 'invalid_phone', 'Enter a mobile number with 10 digits, or with its country code')
  if (h === p.phoneHmac) return fail(409, 'unchanged', 'This number is already on file')
  // Sign-in by phone opens the first record a number belongs to, so one number belongs to one person in this clinic.
  const [other] = await ctx.db.select({ id: patients.id }).from(patients).where(and(eq(patients.phoneHmac, h), ne(patients.id, patientId))).limit(1)
  const [cg] = await ctx.db.select({ id: caregivers.id }).from(caregivers).where(and(eq(caregivers.phoneHmac, h), eq(caregivers.active, true), isNull(caregivers.revokedAt))).limit(1)
  if (other || cg) return fail(409, 'phone_in_use', 'This number is already on another record in this clinic (a patient or a caregiver)')
  // The old number hears about it first, so a change they did not make is noticed.
  const oldNotified = !!p.phoneEnc
    && await tellPatient(ctx.db, { orgId: ctx.session.orgId, patientId, templateKey: 'patient_phone.changed', body: registrationCopy.patientPhoneSms })
  await ctx.db.update(patients).set({ phoneEnc: encryptField(phone), phoneHmac: h, updatedAt: new Date() }).where(eq(patients.id, patientId))
  await ctx.audit('patient.phone_changed', 'patient', patientId, { hadPhone: !!p.phoneEnc, oldNotified, method: 'witnessed' })
  return { ok: true, phoneMasked: maskPhone(phone) }
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
 * Time-limited access outside consent. The org_admin alert: the new row stays unreviewed, shown on every /admin page
 * until an org_admin marks it reviewed (admin/ops.ts; staff have no phone in the schema). The patient or primary
 * contact gets a neutral SMS.
 */
export async function grantBreakGlass(ctx: StaffCtx<z.infer<typeof breakGlassSchema>>, patientId: string) {
  const p = await loadFor(ctx, patientId, false) // RLS keeps it in-org; break-glass is the access path when consent is absent
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
