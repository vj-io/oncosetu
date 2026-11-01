// Caregiver delegation (FR-CON-02) and revocation (E-ID-09).
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Tx } from '@/db'
import { caregivers, patients, sessions } from '@/db/schema'
import { encryptField, normalizePhone, phoneHmac } from '../crypto'
import { HttpError } from '../http'
import { confirmAction, confirmPurpose } from './confirm'
import { patientOwnTarget } from './contact'
import type { AuditFn, StaffCtx } from './http'
import { caregiverInput, confirmSchema } from './schemas'

/** Default delegation scope. The patient portal reads these keys; a caregiver never edits their own. */
export const DEFAULT_CAREGIVER_SCOPE = { view: true, upload: true, statements: true, requests: true, share: true }

export async function insertCaregiver(tx: Tx, p: {
  orgId: string; patientId: string; staffId: string; name: string; relation: string; phone: string; isGuardian: boolean
}): Promise<string> {
  const norm = normalizePhone(p.phone)
  const h = phoneHmac(p.phone)
  if (!norm || !h) throw new HttpError(400, 'invalid_phone', 'Enter a valid phone number for the caregiver')
  const [row] = await tx.insert(caregivers).values({
    orgId: p.orgId, patientId: p.patientId, nameEnc: encryptField(p.name), relation: p.relation, phoneEnc: encryptField(norm),
    phoneHmac: h, scope: DEFAULT_CAREGIVER_SCOPE, isGuardian: p.isGuardian, createdBy: p.staffId,
  }).returning({ id: caregivers.id })
  return row.id
}

/** Ends the caregiver's access: the row is switched off and live sessions die (also denied on the next request). */
export async function revokeCaregiver(tx: Tx, audit: AuditFn, patientId: string, caregiverId: string): Promise<'ok' | 'not_found' | 'last_contact'> {
  const [c] = await tx.select().from(caregivers).where(and(eq(caregivers.id, caregiverId), eq(caregivers.patientId, patientId)))
  if (!c) return 'not_found'
  if (!c.active || c.revokedAt) return 'ok'
  const [p] = await tx.select({ minor: patients.minor, primary: patients.primaryContact }).from(patients).where(eq(patients.id, patientId))
  const others = await tx.select({ id: caregivers.id }).from(caregivers).where(and(
    eq(caregivers.patientId, patientId), eq(caregivers.active, true), isNull(caregivers.revokedAt)))
  if ((p?.minor || p?.primary === 'caregiver') && others.length <= 1) return 'last_contact'
  const now = new Date()
  await tx.update(caregivers).set({ active: false, revokedAt: now }).where(eq(caregivers.id, caregiverId))
  const dead = await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.caregiverId, caregiverId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id })
  await audit('caregiver.revoked', 'caregiver', caregiverId, { patientId, endedSessions: dead.length })
  return 'ok'
}

export const addCaregiverSchema = caregiverInput.extend({ confirm: confirmSchema })

/**
 * Adds a caregiver. The patient confirms (a code to THEIR phone, the guardian's for a minor) or staff witness it in
 * person: a caregiver can never confirm their own delegation (PRD §6.1).
 */
export async function addCaregiver(ctx: StaffCtx<z.infer<typeof addCaregiverSchema>>, patientId: string) {
  const { session: s, body, db: tx } = ctx
  const [p] = await tx.select({ minor: patients.minor, deceased: patients.deceased }).from(patients).where(eq(patients.id, patientId))
  if (!p) throw new HttpError(404, 'not_found', 'Not found')
  if (p.deceased) throw new HttpError(409, 'deceased', 'This patient is recorded as deceased')
  const c = await confirmAction(await patientOwnTarget(tx, patientId), confirmPurpose(patientId), body.confirm)
  if (!c.ok) return c.response
  const id = await insertCaregiver(tx, {
    orgId: s.orgId, patientId, staffId: s.staffId, name: body.name, relation: body.relation, phone: body.phone, isGuardian: p.minor && body.isGuardian,
  })
  await ctx.audit('caregiver.added', 'caregiver', id, { patientId, method: c.method, guardian: p.minor && body.isGuardian })
  return { ok: true, caregiverId: id }
}
