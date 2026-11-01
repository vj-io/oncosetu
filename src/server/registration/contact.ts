// Who a message or code goes to for a patient (FR-CON-07 primary contact, FR-CON-03 minors, E-ID-08 no phone).
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { Tx } from '@/db'
import { caregivers, patients } from '@/db/schema'
import { decryptField } from '../crypto'
import { sendMessage } from '../outbox'

export type ContactTarget = { phone: string; lang: 'en' | 'hi'; caregiverId: string | null }

async function activeCaregivers(tx: Tx, patientId: string) {
  return tx.select().from(caregivers)
    .where(and(eq(caregivers.patientId, patientId), eq(caregivers.active, true), isNull(caregivers.revokedAt)))
    .orderBy(desc(caregivers.isGuardian), asc(caregivers.createdAt))
}

const viaCaregiver = (c: typeof caregivers.$inferSelect, lang: 'en' | 'hi'): ContactTarget =>
  ({ phone: decryptField(c.phoneEnc), lang, caregiverId: c.id })

/**
 * The primary contact: the caregiver (guardian first) when the caregiver is primary or the patient is a minor,
 * else the patient. A patient with no phone falls back to a caregiver's phone (E-ID-08). null = nobody reachable.
 */
export async function primaryContactTarget(tx: Tx, patientId: string): Promise<ContactTarget | null> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId))
  if (!p) return null
  const cgs = await activeCaregivers(tx, patientId)
  if (p.minor || p.primaryContact === 'caregiver') return cgs[0] ? viaCaregiver(cgs[0], p.preferredLanguage) : null
  if (p.phoneEnc) return { phone: decryptField(p.phoneEnc), lang: p.preferredLanguage, caregiverId: null }
  return cgs[0] ? viaCaregiver(cgs[0], p.preferredLanguage) : null
}

/**
 * The patient's OWN phone (the guardian's for a minor). Used where a caregiver must not confirm for themselves
 * (adding a caregiver, handing control to the patient). null = use in-person witnessed confirmation instead.
 */
export async function patientOwnTarget(tx: Tx, patientId: string): Promise<ContactTarget | null> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId))
  if (!p) return null
  if (p.minor) {
    const g = (await activeCaregivers(tx, patientId)).find((c) => c.isGuardian)
    return g ? viaCaregiver(g, p.preferredLanguage) : null
  }
  return p.phoneEnc ? { phone: decryptField(p.phoneEnc), lang: p.preferredLanguage, caregiverId: null } : null
}

/** The patient's own phone whatever their age: the adult patient confirming that control passes to them (E-ID-10). */
export async function patientPhoneTarget(tx: Tx, patientId: string): Promise<ContactTarget | null> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId))
  return p?.phoneEnc ? { phone: decryptField(p.phoneEnc), lang: p.preferredLanguage, caregiverId: null } : null
}

/**
 * Neutral SMS to the patient's OWN phone (not the caregiver's) when who can act for them changes, so a change they
 * did not make is noticed. Skipped with no phone on file or a deceased patient. Returns whether it was sent.
 */
export async function tellPatient(tx: Tx, p: { orgId: string; patientId: string; templateKey: string; body: { en: string; hi: string } }): Promise<boolean> {
  const [r] = await tx.select({ phoneEnc: patients.phoneEnc, deceased: patients.deceased, lang: patients.preferredLanguage })
    .from(patients).where(eq(patients.id, p.patientId))
  if (!r?.phoneEnc || r.deceased) return false
  await sendMessage(tx, { orgId: p.orgId, patientId: p.patientId, toPhone: decryptField(r.phoneEnc), channel: 'sms', templateKey: p.templateKey, body: p.body[r.lang], lang: r.lang })
  return true
}
