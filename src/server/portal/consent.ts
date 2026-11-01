// Consent as the patient controls it (FR-CON-04: withdrawal is one tap and is checked on use) and caregiver revoke.
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Lang } from '@/core/types'
import type { Tx } from '@/db'
import { caregivers, consents, sessions, type ConsentPurposes } from '@/db/schema'
import { now } from '../clock'
import { decryptField } from '../crypto'
import { cancelOpenErasure } from '../erasure/erasure'
import { activeConsent } from '../patients'
import { revokeAllShares } from './shares'

export const PURPOSES = ['store', 'ai', 'share', 'abdm', 'metrics'] as const
export const NO_PURPOSES: ConsentPurposes = { store: false, ai: false, share: false, abdm: false, metrics: false }

export type ConsentView = {
  purposes: ConsentPurposes
  /** ISO time of the latest consent row, or null when none was ever recorded. */
  recordedAt: string | null
  withdrawn: boolean
  caregivers: { id: string; name: string; relation: string; active: boolean }[]
}

export async function loadConsentView(tx: Tx, patientId: string): Promise<ConsentView> {
  const [last] = await tx.select({ at: consents.recordedAt, action: consents.action }).from(consents)
    .where(eq(consents.patientId, patientId)).orderBy(desc(consents.recordedAt), desc(consents.id)).limit(1)
  const active = await activeConsent(tx, patientId)
  const cgs = await tx.select().from(caregivers).where(eq(caregivers.patientId, patientId)).orderBy(caregivers.createdAt)
  return {
    purposes: active?.purposes ?? NO_PURPOSES,
    recordedAt: last?.at.toISOString() ?? null,
    withdrawn: last?.action === 'withdraw',
    caregivers: cgs.map((c) => ({ id: c.id, name: decryptField(c.nameEnc), relation: c.relation, active: c.active && !c.revokedAt })),
  }
}

type Who = { orgId: string; patientId: string; actor: { kind: 'patient' | 'caregiver'; id: string }; lang: Lang }

/**
 * Appends a consent row (the table is append-only; the latest row is the current state). `withdraw` turns every
 * purpose off. Active share links are switched off on withdrawal and when the share purpose is turned off.
 */
export async function recordConsent(tx: Tx, w: Who, purposes: ConsentPurposes, withdraw: boolean): Promise<{ sharesRevoked: number; erasureCancelled: string[] }> {
  const prev = await activeConsent(tx, w.patientId)
  const [last] = await tx.select({ notice: consents.noticeVersion }).from(consents)
    .where(eq(consents.patientId, w.patientId)).orderBy(desc(consents.recordedAt), desc(consents.id)).limit(1)
  const next = withdraw ? NO_PURPOSES : purposes
  await tx.insert(consents).values({
    orgId: w.orgId, patientId: w.patientId, action: withdraw ? 'withdraw' : last ? 'update' : 'grant', purposes: next,
    actorType: w.actor.kind, actorId: w.actor.id, method: 'self', noticeVersion: prev?.noticeVersion ?? last?.notice ?? 'v1',
    language: w.lang, // recorded_at is the database clock, like every staff-written row: activeConsent orders by it, so a demo-clock value here could outrank a later withdrawal
  })
  const sharesRevoked = withdraw || (prev?.purposes.share && !next.share) ? await revokeAllShares(tx, w.orgId, w.patientId) : 0
  const erasureCancelled = next.store ? await cancelOpenErasure(tx, w.patientId) : [] // J8: turning permission back on cancels a waiting erasure request
  return { sharesRevoked, erasureCancelled }
}

/** Patient only. The caregiver's sessions end at once; unknown or foreign ids give false (uniform 404). */
export async function revokeCaregiver(tx: Tx, orgId: string, patientId: string, caregiverId: string): Promise<boolean> {
  const at = await now(orgId)
  const rows = await tx.update(caregivers).set({ active: false, revokedAt: sql`coalesce(${caregivers.revokedAt}, ${at.toISOString()}::timestamptz)` })
    .where(and(eq(caregivers.id, caregiverId), eq(caregivers.patientId, patientId))).returning({ id: caregivers.id })
  if (!rows.length) return false
  await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.caregiverId, caregiverId), isNull(sessions.revokedAt)))
  return true
}
