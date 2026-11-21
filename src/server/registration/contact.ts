// Who a message or code goes to for a patient (FR-CON-07 primary contact, FR-CON-03 minors, E-ID-08 no phone).
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { Tx } from '@/db'
import { caregivers, patients } from '@/db/schema'
import { readOrNull } from '../unreadable'
import { sendMessage } from '../outbox'
import { inLang } from '@/core/copy'
import type { Lang } from '@/core/types'

export type ContactTarget = { phone: string; lang: Lang; caregiverId: string | null }

async function activeCaregivers(tx: Tx, patientId: string) {
  return tx.select().from(caregivers)
    .where(and(eq(caregivers.patientId, patientId), eq(caregivers.active, true), isNull(caregivers.revokedAt)))
    .orderBy(desc(caregivers.isGuardian), asc(caregivers.createdAt))
}

// A phone that cannot be decrypted counts as no phone: the caller then falls back exactly as for a missing one
// (a caregiver's phone, or confirmation in person with a witness). Only the row id and an error code are logged.
const phoneOf = (enc: string | null, rowId: string) => readOrNull(enc, 'contact phone', rowId)

const viaCaregiver = (c: typeof caregivers.$inferSelect, lang: Lang): ContactTarget | null => {
  const phone = phoneOf(c.phoneEnc, c.patientId)
  return phone ? { phone, lang, caregiverId: c.id } : null
}

/**
 * The primary contact: the caregiver (guardian first) when the caregiver is primary or the patient is a minor,
 * else the patient. A patient with no phone falls back to a caregiver's phone (E-ID-08). null = nobody reachable.
 */
export async function primaryContactTarget(tx: Tx, patientId: string): Promise<ContactTarget | null> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId))
  if (!p) return null
  const cgs = await activeCaregivers(tx, patientId)
  if (p.minor || p.primaryContact === 'caregiver') return cgs[0] ? viaCaregiver(cgs[0], p.preferredLanguage) : null
  const own = phoneOf(p.phoneEnc, p.id)
  if (own) return { phone: own, lang: p.preferredLanguage, caregiverId: null }
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
  const own = phoneOf(p.phoneEnc, p.id)
  return own ? { phone: own, lang: p.preferredLanguage, caregiverId: null } : null
}

/** The patient's own phone whatever their age: the adult patient confirming that control passes to them (E-ID-10). */
export async function patientPhoneTarget(tx: Tx, patientId: string): Promise<ContactTarget | null> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId))
  const own = p ? phoneOf(p.phoneEnc, p.id) : null
  return own ? { phone: own, lang: p!.preferredLanguage, caregiverId: null } : null
}

/**
 * Neutral SMS to the patient's OWN phone (not the caregiver's) when who can act for them changes, so a change they
 * did not make is noticed. Skipped with no phone on file or a deceased patient. Returns whether it was sent.
 */
export async function tellPatient(tx: Tx, p: { orgId: string; patientId: string; templateKey: string; body: { en: string; hi: string; hinglish?: string } }): Promise<boolean> {
  const [r] = await tx.select({ phoneEnc: patients.phoneEnc, deceased: patients.deceased, lang: patients.preferredLanguage })
    .from(patients).where(eq(patients.id, p.patientId))
  const to = r ? phoneOf(r.phoneEnc, p.patientId) : null
  if (!to || r!.deceased) return false
  await sendMessage(tx, { orgId: p.orgId, patientId: p.patientId, toPhone: to, channel: 'sms', templateKey: p.templateKey, body: inLang(p.body, r.lang), lang: r.lang })
  return true
}
