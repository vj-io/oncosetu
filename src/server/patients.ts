// Patient view + access policy (consent checked on use, never cached — FR-CON-04).
import { and, desc, eq, gt } from 'drizzle-orm'
import type { Tx } from '@/db'
import { breakGlass, caregivers, consents, patients, type ConsentPurposes } from '@/db/schema'
import { decryptField, maskPhone } from './crypto'
import { HttpError } from './http'
import type { Session } from './session'

export type PatientView = {
  id: string; orgId: string; name: string; initials: string; dob: string | null; ageYears: number | null
  sex: 'female' | 'male' | 'other' | 'unknown'; phoneMasked: string | null; mrn: string | null
  disclosure: 'cleared' | 'not_cleared' | 'unknown'; primaryContact: 'patient' | 'caregiver'; minor: boolean
  deceased: boolean; preferredLanguage: 'en' | 'hi'; tokenRevoked: boolean; status: string
  caregivers: { id: string; name: string; relation: string; phoneMasked: string; isGuardian: boolean; active: boolean }[]
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((w) => [...w][0]?.toUpperCase() ?? '').join('')
}

/** Whole years between an ISO date (YYYY-MM-DD) and `at`. */
export function ageYears(dob: string, at = new Date()): number {
  const [y, m, d] = dob.split('-').map(Number)
  let age = at.getUTCFullYear() - y
  if (at.getUTCMonth() + 1 < m || (at.getUTCMonth() + 1 === m && at.getUTCDate() < d)) age--
  return age
}

/** Decrypted view of a patient visible under the current RLS org, or null. */
export async function loadPatient(tx: Tx, id: string): Promise<PatientView | null> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, id))
  if (!p) return null
  const cgs = await tx.select().from(caregivers).where(eq(caregivers.patientId, id)).orderBy(caregivers.createdAt)
  const name = decryptField(p.nameEnc)
  const dob = p.dobEnc ? decryptField(p.dobEnc) : null
  return {
    id: p.id, orgId: p.orgId, name, initials: initials(name), dob, ageYears: dob ? ageYears(dob) : null, sex: p.sex,
    phoneMasked: p.phoneEnc ? maskPhone(decryptField(p.phoneEnc)) : null, mrn: p.mrn, disclosure: p.disclosureStatus,
    primaryContact: p.primaryContact, minor: p.minor, deceased: p.deceased, preferredLanguage: p.preferredLanguage,
    tokenRevoked: !!p.tokenRevokedAt, status: p.status,
    caregivers: cgs.map((c) => ({
      id: c.id, name: decryptField(c.nameEnc), relation: c.relation, phoneMasked: maskPhone(decryptField(c.phoneEnc)),
      isGuardian: c.isGuardian, active: c.active && !c.revokedAt,
    })),
  }
}

export type ActiveConsent = { id: string; purposes: ConsentPurposes; noticeVersion: string; language: string; recordedAt: Date }

/** Latest consent state for the patient; null if none recorded or the latest row is a withdrawal. */
export async function activeConsent(tx: Tx, patientId: string): Promise<ActiveConsent | null> {
  const [c] = await tx.select().from(consents).where(eq(consents.patientId, patientId))
    .orderBy(desc(consents.recordedAt), desc(consents.id)).limit(1)
  if (!c || c.action === 'withdraw') return null
  return { id: c.id, purposes: c.purposes, noticeVersion: c.noticeVersion, language: c.language, recordedAt: c.recordedAt }
}

/** Throws 403 consent_required unless the latest consent grants `purpose`. Call on every use. */
export async function assertConsent(tx: Tx, patientId: string, purpose: keyof ConsentPurposes): Promise<void> {
  const c = await activeConsent(tx, patientId)
  if (!c?.purposes[purpose]) throw new HttpError(403, 'consent_required', 'Consent does not cover this action')
}

/**
 * Staff: patient in the session's org (RLS) AND (consent 'store' OR an active break-glass for this staff member).
 *   desk/records/clinician: consent or break-glass; org_admin: break-glass only; auditor: never.
 * Patient/caregiver: own patient only.
 * Unknown / other-org ids → 404 (uniform with not-found).
 */
export async function assertPatientAccess(ctx: { db: Tx; session: Session }, patientId: string): Promise<void> {
  const s = ctx.session
  const notFound = new HttpError(404, 'not_found', 'Not found')
  if (s.kind !== 'staff') {
    if (s.patientId !== patientId) throw notFound
    return
  }
  const [p] = await ctx.db.select({ id: patients.id, orgId: patients.orgId }).from(patients).where(eq(patients.id, patientId))
  if (!p || p.orgId !== s.orgId) throw notFound
  if (s.role === 'auditor') throw new HttpError(403, 'forbidden', 'Not allowed')
  const [bg] = await ctx.db.select({ id: breakGlass.id }).from(breakGlass).where(and(
    eq(breakGlass.patientId, patientId), eq(breakGlass.staffId, s.staffId), gt(breakGlass.expiresAt, new Date()),
  )).limit(1)
  if (bg) return
  if (s.role === 'org_admin') throw new HttpError(403, 'break_glass_required', 'Break-glass access required')
  if (!(await activeConsent(ctx.db, patientId))?.purposes.store) {
    throw new HttpError(403, 'consent_required', 'No active consent for this patient')
  }
}
