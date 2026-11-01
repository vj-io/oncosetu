// J7 from the patient's side: "Something wrong with this?" on a document in the portal. Every live event read from that
// document becomes `disputed` (one `verifications` row each, reason = a code, never free text) and the document is
// flagged `patient_disputed`. The originals are kept; staff see the disputed status in the ledger.
import { and, eq, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents, events, verifications } from '@/db/schema'
import type { AuditDetails } from '../audit'
import { now } from '../clock'
import { HttpError } from '../http'
import { can } from '../rbac'
import { sessionRole, type PatientSession } from '../session'
import type { DisputeReason } from './dispute-reasons'

export { DISPUTE_REASONS, type DisputeReason } from './dispute-reasons'

type Row = { id: string; verificationStatus: string; withdrawnAt: Date | null; supersedesId: string | null }

/** The document's current events (not withdrawn, rejected or superseded by an edit) that are not disputed yet. */
export function eventsToDispute<T extends Row>(rows: T[]): T[] {
  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean) as string[])
  return rows.filter((r) => !r.withdrawnAt && !superseded.has(r.id) && r.verificationStatus !== 'rejected' && r.verificationStatus !== 'disputed')
}

type Ctx = {
  db: Tx; session: PatientSession
  audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}

export async function disputeDocument(ctx: Ctx, documentId: string, reason: DisputeReason): Promise<{ ok: true; events: number }> {
  const s = ctx.session
  if (!can(sessionRole(s), 'event.dispute')) throw new HttpError(403, 'forbidden', 'Not allowed')
  const [doc] = await ctx.db.select({ patientId: documents.patientId }).from(documents).where(eq(documents.id, documentId))
  if (!doc || doc.patientId !== s.patientId) throw new HttpError(404, 'not_found', 'Not found') // uniform: another patient's id looks the same
  const rows = await ctx.db.select({
    id: events.id, verificationStatus: events.verificationStatus, withdrawnAt: events.withdrawnAt, supersedesId: events.supersedesId, rowVersion: events.rowVersion,
  }).from(events).where(and(eq(events.documentId, documentId), eq(events.patientId, s.patientId)))

  const by = { kind: s.kind, id: s.caregiverId ?? s.patientId }
  const at = await now(s.orgId)
  const done: { id: string; from: typeof rows[number]['verificationStatus'] }[] = []
  for (const e of eventsToDispute(rows)) {
    const r = await ctx.db.update(events).set({ verificationStatus: 'disputed', rowVersion: sql`${events.rowVersion} + 1`, updatedAt: at })
      .where(and(eq(events.id, e.id), eq(events.rowVersion, e.rowVersion))).returning({ id: events.id })
    if (r.length) done.push({ id: e.id, from: e.verificationStatus })
  }
  if (done.length) {
    await ctx.db.insert(verifications).values(done.map((d) => ({
      orgId: s.orgId, patientId: s.patientId, eventId: d.id, action: 'dispute' as const, fromStatus: d.from, toStatus: 'disputed' as const,
      actorKind: by.kind, actorId: by.id, role: by.kind, reason, at,
    })))
    for (const d of done) await ctx.audit('event.dispute', 'event', d.id, { patientId: s.patientId, from: d.from, to: 'disputed', reason, documentId })
  }
  await ctx.db.update(documents).set({ flags: sql`${documents.flags} || '{"patient_disputed": true}'::jsonb`, updatedAt: at }).where(eq(documents.id, documentId))
  await ctx.audit('document.dispute', 'document', documentId, { patientId: s.patientId, reason, events: done.length })
  return { ok: true, events: done.length }
}
