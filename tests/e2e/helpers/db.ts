// Direct database access (owner role) for what has no API: reading ids, simulated SMS, nudging the clock backwards,
// closing an encounter. Every read is scoped to the Ganga org. Actions under test still go through the app.
import { and, desc, eq, sql } from 'drizzle-orm'
import { adminDb } from '../../../src/db'
import { auditLog, breakGlass, caregivers, consents, documentPages, documents, encounters, events, evidence, missingRecords, orgSettings, outbox, patientStatements, patients, sessions, snapshots, staff, verifications } from '../../../src/db/schema'
import { phoneHmac } from '../../../src/server/crypto'
import { ORG } from './env'

export const staffId = async (email: string) => (await adminDb.select({ id: staff.id }).from(staff).where(eq(staff.email, email)))[0]?.id as string

export const eventsOf = (patientId: string) =>
  adminDb.select().from(events).where(eq(events.patientId, patientId)).orderBy(events.createdAt)

export const evidenceOf = (eventId: string) => adminDb.select().from(evidence).where(eq(evidence.eventId, eventId))

export const verificationsOf = (eventId: string) => adminDb.select().from(verifications).where(eq(verifications.eventId, eventId))

export const documentsOf = (patientId: string) => adminDb.select().from(documents).where(eq(documents.patientId, patientId))
export const pagesOf = (documentId: string) => adminDb.select().from(documentPages).where(eq(documentPages.documentId, documentId)).orderBy(documentPages.pageNo)

export const missingOf = (patientId: string) =>
  adminDb.select().from(missingRecords).where(eq(missingRecords.patientId, patientId)).orderBy(missingRecords.createdAt)

/** A previous visit is over: the desk can no longer open the record without verifying again (FR-ID-02). */
export const closeEncounters = (patientId: string) =>
  adminDb.update(encounters).set({ closedAt: new Date() }).where(and(eq(encounters.patientId, patientId), sql`closed_at is null`))

/** The org's demo clock, in days (the admin API only offers +7, +21 and reset; a seal in the past needs a negative offset). */
export const setClockDays = (days: number) =>
  adminDb.update(orgSettings).set({ demoClockOffsetS: Math.round(days * 86_400) }).where(eq(orgSettings.orgId, ORG))
export const clockDays = async () => ((await adminDb.select({ s: orgSettings.demoClockOffsetS }).from(orgSettings).where(eq(orgSettings.orgId, ORG)))[0]?.s ?? 0) / 86_400

export type Sms = { body: string; templateKey: string; lang: string; createdAt: Date; patientId: string | null }

/**
 * The simulated phone. GET /api/demo/outbox only lists organisations flagged is_demo, and Ganga is not (its messages
 * must never appear on the public demo page), so the same rows are read from the table the endpoint reads.
 */
export async function smsTo(phone: string): Promise<Sms[]> {
  const h = phoneHmac(phone)
  if (!h) return []
  return adminDb.select({ body: outbox.body, templateKey: outbox.templateKey, lang: outbox.lang, createdAt: outbox.createdAt, patientId: outbox.patientId })
    .from(outbox).where(and(eq(outbox.orgId, ORG), eq(outbox.toHmac, h))).orderBy(desc(outbox.createdAt))
}

export const smsAbout = (patientId: string) =>
  adminDb.select({ body: outbox.body, templateKey: outbox.templateKey, lang: outbox.lang, createdAt: outbox.createdAt, patientId: outbox.patientId })
    .from(outbox).where(and(eq(outbox.orgId, ORG), eq(outbox.patientId, patientId))).orderBy(desc(outbox.createdAt))

export const consentsOf = (patientId: string) =>
  adminDb.select().from(consents).where(eq(consents.patientId, patientId)).orderBy(consents.recordedAt)

export const statementsOf = (patientId: string) =>
  adminDb.select().from(patientStatements).where(eq(patientStatements.patientId, patientId)).orderBy(patientStatements.createdAt)

export const snapshotsOf = (patientId: string) =>
  adminDb.select().from(snapshots).where(eq(snapshots.patientId, patientId)).orderBy(snapshots.seq)

export const breakGlassOf = (patientId: string) => adminDb.select().from(breakGlass).where(eq(breakGlass.patientId, patientId)).orderBy(breakGlass.createdAt)
/** Lets a grant run out without waiting four hours. */
export const expireBreakGlass = (patientId: string) =>
  adminDb.update(breakGlass).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(breakGlass.patientId, patientId))

export const encountersOf = (patientId: string) => adminDb.select().from(encounters).where(eq(encounters.patientId, patientId))
export const patientRow = async (patientId: string) => (await adminDb.select().from(patients).where(eq(patients.id, patientId)))[0]

export const auditOf = (targetId: string, action: string) =>
  adminDb.select().from(auditLog).where(and(eq(auditLog.orgId, ORG), eq(auditLog.targetId, targetId), eq(auditLog.action, action)))
export const caregiversOf = (patientId: string) => adminDb.select().from(caregivers).where(eq(caregivers.patientId, patientId))
/** Portal sessions of one caregiver that still work (not revoked). */
export const liveCaregiverSessions = (caregiverId: string) =>
  adminDb.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.caregiverId, caregiverId), sql`revoked_at is null`))
