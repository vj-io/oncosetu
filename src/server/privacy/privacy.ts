// DPDP notice acknowledgement and the masked ID record. Draft wording, legal review pending (see src/i18n/privacy.ts).
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Tx } from '@/db'
import { idVerifications, privacyAcknowledgements, staff, type IdType } from '@/db/schema'
import { maskId } from '@/core/idcheck'
import type { Lang } from '@/core/types'

/** Bump when the notice text changes: everyone is asked to acknowledge the new version. */
export const NOTICE_VERSION = 'dpdp-draft-v1'

export type PrivacyView = {
  noticeVersion: string
  /** This person's latest acknowledgement (patient or caregiver, whoever is signed in). */
  mine: { version: string; at: string; current: boolean } | null
  idRecord: { idType: IdType; masked: string; verifiedBy: string; verifiedAt: string } | null
}

export async function loadPrivacyView(tx: Tx, patientId: string, actorId: string): Promise<PrivacyView> {
  const [ack] = await tx.select().from(privacyAcknowledgements)
    .where(and(eq(privacyAcknowledgements.patientId, patientId), eq(privacyAcknowledgements.actorId, actorId)))
    .orderBy(desc(privacyAcknowledgements.acknowledgedAt), desc(privacyAcknowledgements.id)).limit(1)
  return {
    noticeVersion: NOTICE_VERSION,
    mine: ack ? { version: ack.noticeVersion, at: ack.acknowledgedAt.toISOString(), current: ack.noticeVersion === NOTICE_VERSION } : null,
    idRecord: await loadIdRecord(tx, patientId),
  }
}

export async function loadIdRecord(tx: Tx, patientId: string): Promise<PrivacyView['idRecord']> {
  const [r] = await tx.select({ t: idVerifications.idType, l: idVerifications.last4, at: idVerifications.verifiedAt, by: staff.name })
    .from(idVerifications).innerJoin(staff, eq(staff.id, idVerifications.verifiedBy))
    .where(and(eq(idVerifications.patientId, patientId), isNull(idVerifications.revokedAt)))
    .orderBy(desc(idVerifications.verifiedAt), desc(idVerifications.id)).limit(1)
  return r ? { idType: r.t, masked: maskId(r.t, r.l), verifiedBy: r.by, verifiedAt: r.at.toISOString() } : null
}

export async function recordAcknowledgement(tx: Tx, w: { orgId: string; patientId: string; actor: { kind: 'patient' | 'caregiver'; id: string }; lang: Lang }): Promise<{ version: string }> {
  await tx.insert(privacyAcknowledgements).values({ orgId: w.orgId, patientId: w.patientId, actorType: w.actor.kind, actorId: w.actor.id, noticeVersion: NOTICE_VERSION, language: w.lang })
  return { version: NOTICE_VERSION }
}

/** A newer record replaces the old one (the old row is kept, marked revoked). */
export async function recordIdVerification(tx: Tx, w: { orgId: string; patientId: string; staffId: string; idType: IdType; last4: string }): Promise<{ id: string }> {
  await tx.update(idVerifications).set({ revokedAt: new Date() }).where(and(eq(idVerifications.patientId, w.patientId), isNull(idVerifications.revokedAt)))
  const [row] = await tx.insert(idVerifications).values({ orgId: w.orgId, patientId: w.patientId, idType: w.idType, last4: w.last4, verifiedBy: w.staffId }).returning({ id: idVerifications.id })
  return row
}
