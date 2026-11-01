// Patient-scoped audit rows and the access log (FR-CON-05), read-only. Rows hold ids and enums only.
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { auditLog, documents, events, shareViews, staff } from '@/db/schema'

export type AuditRowView = {
  seq: number; at: Date; actorRole: string; actorId: string | null; actorName: string | null
  action: string; targetType: string | null; targetId: string | null
}

// Document and event rows (upload, duplicate, quarantine, view, verify...) target the document/event id and carry no patientId
// in details, so they belong to the patient through the document/event itself (same rule as the portal's access log).
const forPatient = (patientId: string) => or(
  and(eq(auditLog.targetType, 'patient'), eq(auditLog.targetId, patientId)),
  sql`${auditLog.details}->>'patientId' = ${patientId}`,
  and(eq(auditLog.targetType, 'document'), sql`${auditLog.targetId} in (select ${documents.id}::text from ${documents} where ${documents.patientId} = ${patientId})`),
  and(eq(auditLog.targetType, 'event'), sql`${auditLog.targetId} in (select ${events.id}::text from ${events} where ${events.patientId} = ${patientId})`),
)!

async function withNames(tx: Tx, rows: (typeof auditLog.$inferSelect)[]): Promise<AuditRowView[]> {
  const ids = [...new Set(rows.filter((r) => r.actorRole !== 'patient' && r.actorRole !== 'caregiver').map((r) => r.actorId).filter((x): x is string => !!x))]
  const names = ids.length ? await tx.select({ id: staff.id, name: staff.name }).from(staff).where(inArray(staff.id, ids)) : []
  const nameOf = new Map(names.map((n) => [n.id, n.name]))
  return rows.map((r) => ({
    seq: r.seq, at: r.at, actorRole: r.actorRole, actorId: r.actorId, actorName: (r.actorId && nameOf.get(r.actorId)) || null,
    action: r.action, targetType: r.targetType, targetId: r.targetId,
  }))
}

/** Newest first. A row belongs to the patient when it targets them or names them in details.patientId. */
export async function patientAuditRows(tx: Tx, patientId: string, limit = 200): Promise<AuditRowView[]> {
  const rows = await tx.select().from(auditLog).where(forPatient(patientId)).orderBy(desc(auditLog.seq)).limit(limit)
  return withNames(tx, rows)
}

const ACCESS_ACTIONS = '(view|export|download|share|print|desk\\.verified|break_glass|opened|login)'

export type AccessLog = { events: AuditRowView[]; shareViews: { id: string; at: Date; outcome: string; shareLinkId: string }[] }

/** Who viewed or exported what, when: audit rows with an access-type action plus every share-link view attempt. */
export async function accessLog(tx: Tx, patientId: string, limit = 50): Promise<AccessLog> {
  const rows = await tx.select().from(auditLog)
    .where(and(forPatient(patientId), sql`${auditLog.action} ~ ${ACCESS_ACTIONS}`)).orderBy(desc(auditLog.seq)).limit(limit)
  const views = await tx.select({ id: shareViews.id, at: shareViews.at, outcome: shareViews.outcome, shareLinkId: shareViews.shareLinkId })
    .from(shareViews).where(eq(shareViews.patientId, patientId)).orderBy(desc(shareViews.at)).limit(limit)
  return { events: await withNames(tx, rows), shareViews: views }
}
