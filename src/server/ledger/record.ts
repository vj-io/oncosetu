// DB loaders for the ledger (run inside withOrg / ctx.db, after assertPatientAccess).
import { and, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { auditLog, documents, events, evidence, missingRecords, patientStatements, snapshots, staff, verifications } from '@/db/schema'
import { buildSnapshot, diffLedger, type Snapshot } from '@/core/ledger'
import {
  assembleRecord, buildLedgerView, buildTimeline, isResolved, snapshotSummary,
  type LedgerView, type RecordRows, type SnapshotSummary, type TimelineFilters, type TimelineView,
} from './core'

export async function loadRecordRows(tx: Tx, patientId: string): Promise<RecordRows> {
  const [evs, evd, docs, stmts, miss, vers] = await Promise.all([
    tx.select().from(events).where(eq(events.patientId, patientId)),
    tx.select({
      eventId: evidence.eventId, documentId: evidence.documentId, pageNo: evidence.pageNo, charStart: evidence.charStart,
      charEnd: evidence.charEnd, quote: evidence.quote, quoteSha256: evidence.quoteSha256, statementId: evidence.statementId,
    }).from(evidence).where(eq(evidence.patientId, patientId)),
    tx.select({
      id: documents.id, docType: documents.docType, documentDate: documents.documentDate, receivedAt: documents.receivedAt,
      institutionName: documents.institutionName, sha256: documents.sha256, amendmentOf: documents.amendmentOf,
      duplicateOf: documents.duplicateOf, attachState: documents.attachState, attachDecidedAt: documents.attachDecidedAt,
      identityResult: documents.identityResult, status: documents.status,
    }).from(documents).where(eq(documents.patientId, patientId)),
    tx.select({
      id: patientStatements.id, questionId: patientStatements.questionId, answer: patientStatements.answer, transcript: patientStatements.transcript,
      language: patientStatements.language, confirmation: patientStatements.confirmation, createdAt: patientStatements.createdAt,
    }).from(patientStatements).where(eq(patientStatements.patientId, patientId)),
    tx.select({
      ruleId: missingRecords.ruleId, ruleVersion: missingRecords.ruleVersion, mode: missingRecords.mode, triggerEventId: missingRecords.triggerEventId,
      expectedTypes: missingRecords.expectedTypes, state: missingRecords.state, dedupeKey: missingRecords.dedupeKey, matchWindow: missingRecords.matchWindow,
    }).from(missingRecords).where(eq(missingRecords.patientId, patientId)),
    tx.select({
      eventId: verifications.eventId, action: verifications.action, toStatus: verifications.toStatus, role: verifications.role,
      at: verifications.at, viewedSource: verifications.viewedSource, actorName: staff.name,
    }).from(verifications).leftJoin(staff, eq(staff.id, verifications.actorId)).where(eq(verifications.patientId, patientId)),
  ])
  return { patientId, events: evs, evidence: evd, documents: docs, statements: stmts, missing: miss, verifications: vers }
}

export type SnapshotRow = typeof snapshots.$inferSelect

export async function latestSnapshot(tx: Tx, patientId: string): Promise<{ row: SnapshotRow; snapshot: Snapshot; summary: SnapshotSummary } | null> {
  const [r] = await tx.select({ s: snapshots, signer: staff.name }).from(snapshots).leftJoin(staff, eq(staff.id, snapshots.signerId))
    .where(eq(snapshots.patientId, patientId)).orderBy(desc(snapshots.seq)).limit(1)
  if (!r) return null
  return { row: r.s, snapshot: JSON.parse(r.s.canonicalJson) as Snapshot, summary: snapshotSummary(r.s, r.signer) }
}

export async function listSnapshots(tx: Tx, patientId: string): Promise<SnapshotSummary[]> {
  const rows = await tx.select({ id: snapshots.id, seq: snapshots.seq, sha256: snapshots.sha256, sealedAt: snapshots.sealedAt, keyId: snapshots.keyId, signer: staff.name })
    .from(snapshots).leftJoin(staff, eq(staff.id, snapshots.signerId)).where(eq(snapshots.patientId, patientId)).orderBy(desc(snapshots.seq))
  return rows.map((r) => snapshotSummary(r, r.signer))
}

export const VIEW_WINDOW_MS = 30 * 60_000

/**
 * Event ids whose source this staff member opened in the last 30 min (FR-VER-03). Reads the Pipeline's audit rows
 * for the source viewer: any action containing "view" that targets the event, or names it in details.eventId.
 */
// ponytail: scans recent audit rows by actor (no index on actor/at); add one if audit_log grows past ~1M rows per org.
export async function viewedEventIds(tx: Tx, staffId: string, eventIds?: string[]): Promise<Set<string>> {
  const since = new Date(Date.now() - VIEW_WINDOW_MS)
  const target = sql<string>`coalesce(${auditLog.details}->>'eventId', ${auditLog.targetId})`
  const rows = await tx.select({ id: target }).from(auditLog).where(and(
    eq(auditLog.actorId, staffId), gt(auditLog.at, since), ilike(auditLog.action, '%view%'),
    or(eq(auditLog.targetType, 'event'), sql`${auditLog.details} ? 'eventId'`),
    eventIds?.length ? or(inArray(auditLog.targetId, eventIds), inArray(sql`${auditLog.details}->>'eventId'`, eventIds)) : undefined,
  ))
  return new Set(rows.map((r) => r.id).filter(Boolean))
}

/** Rows + last seal + this actor's recent source views → the ledger view. */
export async function loadLedger(tx: Tx, patientId: string, actor: { staffId: string; role: string }, now: Date): Promise<LedgerView> {
  const [rows, prev, viewed] = await Promise.all([loadRecordRows(tx, patientId), latestSnapshot(tx, patientId), viewedEventIds(tx, actor.staffId)])
  return buildLedgerView({ rows, prev: prev && { snapshot: prev.snapshot, summary: prev.summary }, role: actor.role, now: now.toISOString(), viewedByMe: viewed })
}

/**
 * Timeline (FR-TML-01..04): the live record, or the record as it stood at a sealed snapshot (asOf). Both render
 * from the Snapshot shape; quotes are looked up by the hashes the snapshot holds.
 */
export async function loadTimeline(tx: Tx, patientId: string, now: Date, asOf: string | null, filters: TimelineFilters): Promise<{ view: TimelineView; asOf: SnapshotSummary | null; snapshots: SnapshotSummary[] }> {
  const snaps = await listSnapshots(tx, patientId)
  const pick = asOf ? snaps.find((s) => s.id === asOf) ?? null : null
  if (pick) {
    const [[row], quotes] = await Promise.all([
      tx.select({ json: snapshots.canonicalJson }).from(snapshots).where(and(eq(snapshots.id, pick.id), eq(snapshots.patientId, patientId))),
      tx.select({ h: evidence.quoteSha256, q: evidence.quote }).from(evidence).where(eq(evidence.patientId, patientId)),
    ])
    const quoteByHash = new Map(quotes.filter((x) => x.h && x.q).map((x) => [x.h!, x.q!]))
    return { view: buildTimeline(JSON.parse(row.json) as Snapshot, { quoteByHash }, filters), asOf: pick, snapshots: snaps }
  }
  const rows = await loadRecordRows(tx, patientId)
  const { record, rowById } = assembleRecord(rows)
  const conflicts = new Set(diffLedger(null, record, now.toISOString()).conflicts.filter((c) => !isResolved(c, rowById)).flatMap((c) => [c.a.id, c.b.id]))
  const quoteByHash = new Map(rows.evidence.filter((x) => x.quoteSha256 && x.quote).map((x) => [x.quoteSha256!, x.quote!]))
  return { view: buildTimeline(buildSnapshot(record, now.toISOString()), { quoteByHash, conflicts }, filters), asOf: null, snapshots: snaps }
}
