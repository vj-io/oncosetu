// Share links as the patient sees them: expiry, views, revoke. Creation is the Radar-share agent's CreateShareForm.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { shareLinks, shareViews } from '@/db/schema'
import { now } from '../clock'

export type ShareStatus = 'active' | 'expired' | 'revoked' | 'locked'
export type ShareRow = {
  id: string; scope: 'summary' | 'summary_with_documents'; status: ShareStatus
  createdAt: string; expiresAt: string; opened: number
}

export function shareStatus(s: { revokedAt: Date | null; lockedAt: Date | null; expiresAt: Date }, at: Date): ShareStatus {
  if (s.revokedAt) return 'revoked'
  if (s.expiresAt <= at) return 'expired'
  return s.lockedAt ? 'locked' : 'active'
}

export async function loadShares(tx: Tx, orgId: string, patientId: string): Promise<ShareRow[]> {
  const at = await now(orgId)
  const rows = await tx.select({
    id: shareLinks.id, scope: shareLinks.scope, createdAt: shareLinks.createdAt, expiresAt: shareLinks.expiresAt,
    revokedAt: shareLinks.revokedAt, lockedAt: shareLinks.lockedAt,
  }).from(shareLinks).where(eq(shareLinks.patientId, patientId)).orderBy(desc(shareLinks.createdAt)).limit(50)
  const views = rows.length
    ? await tx.select({ id: shareViews.shareLinkId, n: sql<number>`count(*)::int` }).from(shareViews)
      .where(and(inArray(shareViews.shareLinkId, rows.map((r) => r.id)), eq(shareViews.outcome, 'viewed'))).groupBy(shareViews.shareLinkId)
    : []
  const opened = new Map(views.map((v) => [v.id, v.n]))
  return rows.map((r) => ({
    id: r.id, scope: r.scope, status: shareStatus(r, at), createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(), opened: opened.get(r.id) ?? 0,
  }))
}

/** Switches off every active link of the patient; returns how many were switched off. */
export async function revokeAllShares(tx: Tx, orgId: string, patientId: string): Promise<number> {
  const rows = await tx.update(shareLinks).set({ revokedAt: await now(orgId) })
    .where(and(eq(shareLinks.patientId, patientId), isNull(shareLinks.revokedAt))).returning({ id: shareLinks.id })
  return rows.length
}

/** True if the link existed, belonged to the patient and is now off. Unknown or foreign ids give false (uniform 404). */
export async function revokeShare(tx: Tx, orgId: string, patientId: string, shareId: string): Promise<boolean> {
  const rows = await tx.update(shareLinks).set({ revokedAt: await now(orgId) })
    .where(and(eq(shareLinks.id, shareId), eq(shareLinks.patientId, patientId), isNull(shareLinks.revokedAt)))
    .returning({ id: shareLinks.id })
  if (rows.length) return true
  const [exists] = await tx.select({ id: shareLinks.id }).from(shareLinks).where(and(eq(shareLinks.id, shareId), eq(shareLinks.patientId, patientId)))
  return !!exists // already off: still a success for the patient
}
