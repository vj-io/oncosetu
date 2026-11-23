// DB loaders for the ledger (run inside withOrg / ctx.db, after assertPatientAccess).
import { and, desc, eq, sql, type AnyColumn } from 'drizzle-orm'
import type { Tx } from '@/db'
import { auditLog, documents, events, evidence, missingRecords, patientStatements, snapshots, staff, verifications } from '@/db/schema'
import { buildSnapshot, diffLedger, type Snapshot } from '@/core/ledger'
import {
  assembleRecord, buildLedgerView, buildTimeline, isResolved, snapshotSummary,
  type LedgerView, type RecordRows, type SnapshotSummary, type TimelineFilters, type TimelineView,
} from './core'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidLit = (id: string) => {
  if (!UUID.test(id)) throw new Error('expected a UUID')
  return sql.raw(`'${id}'`)
}
/**
 * `col = '<uuid>'` with the id written into the SQL text, not bound as a parameter. Why: the pool runs with prepare:false (Neon's
 * PgBouncer), and then postgres.js sends every query that has bind parameters as describe-then-execute (two round trips) and does not
 * overlap it with the next one, so the "parallel" loads below cost ~1.5 round trips each. A query without parameters goes over the
 * simple protocol and pipelines on the transaction's connection. Measured over a 100 ms link: 8 such queries 1.25 s, 0.35 s without
 * parameters. The id is checked against the UUID grammar first, so nothing else can reach the SQL text.
 */
const idIs = (col: AnyColumn, id: string) => sql`${col} = ${uuidLit(id)}`
/** The same, for a list of ids (each checked against the UUID grammar): `col in ('<uuid>', …)`. */
const idIn = (col: AnyColumn, ids: string[]) => sql`${col} in (${sql.join(ids.map(uuidLit), sql`, `)})`

export async function loadRecordRows(tx: Tx, patientId: string): Promise<RecordRows> {
  const [evs, evd, docs, stmts, miss, vers] = await Promise.all([
    tx.select().from(events).where(idIs(events.patientId, patientId)),
    tx.select({
      eventId: evidence.eventId, documentId: evidence.documentId, pageNo: evidence.pageNo, charStart: evidence.charStart,
      charEnd: evidence.charEnd, quote: evidence.quote, quoteSha256: evidence.quoteSha256, statementId: evidence.statementId,
    }).from(evidence).where(idIs(evidence.patientId, patientId)),
    tx.select({
      id: documents.id, docType: documents.docType, documentDate: documents.documentDate, receivedAt: documents.receivedAt,
      institutionName: documents.institutionName, sha256: documents.sha256, amendmentOf: documents.amendmentOf,
      duplicateOf: documents.duplicateOf, attachState: documents.attachState, attachDecidedAt: documents.attachDecidedAt, attachReason: documents.attachReason,
      identityResult: documents.identityResult, status: documents.status,
    }).from(documents).where(idIs(documents.patientId, patientId)),
    tx.select({
      id: patientStatements.id, questionId: patientStatements.questionId, answer: patientStatements.answer, transcript: patientStatements.transcript,
      language: patientStatements.language, confirmation: patientStatements.confirmation, createdAt: patientStatements.createdAt,
    }).from(patientStatements).where(idIs(patientStatements.patientId, patientId)),
    tx.select({
      ruleId: missingRecords.ruleId, ruleVersion: missingRecords.ruleVersion, mode: missingRecords.mode, triggerEventId: missingRecords.triggerEventId,
      expectedTypes: missingRecords.expectedTypes, state: missingRecords.state, dedupeKey: missingRecords.dedupeKey, matchWindow: missingRecords.matchWindow,
    }).from(missingRecords).where(idIs(missingRecords.patientId, patientId)),
    tx.select({
      eventId: verifications.eventId, action: verifications.action, toStatus: verifications.toStatus, role: verifications.role,
      at: verifications.at, viewedSource: verifications.viewedSource, actorName: staff.name,
    }).from(verifications).leftJoin(staff, eq(staff.id, verifications.actorId)).where(idIs(verifications.patientId, patientId)),
  ])
  return { patientId, events: evs, evidence: evd, documents: docs, statements: stmts, missing: miss, verifications: vers }
}

/**
 * loadRecordRows for many patients in one go: the same six queries with `in (…)`, rows grouped per patient, so the patient
 * list costs seven queries whatever its length (it used to cost seven per patient). Row shapes match loadRecordRows exactly
 * (the patient id used for grouping is removed again), because sealing hashes these rows.
 */
export async function loadRecordRowsFor(tx: Tx, ids: string[]): Promise<Map<string, RecordRows>> {
  const out = new Map<string, RecordRows>(ids.map((id) => [id, { patientId: id, events: [], evidence: [], documents: [], statements: [], missing: [], verifications: [] }]))
  if (!ids.length) return out
  const [evs, evd, docs, stmts, miss, vers] = await Promise.all([
    tx.select().from(events).where(idIn(events.patientId, ids)),
    tx.select({
      pid: evidence.patientId, eventId: evidence.eventId, documentId: evidence.documentId, pageNo: evidence.pageNo, charStart: evidence.charStart,
      charEnd: evidence.charEnd, quote: evidence.quote, quoteSha256: evidence.quoteSha256, statementId: evidence.statementId,
    }).from(evidence).where(idIn(evidence.patientId, ids)),
    tx.select({
      pid: documents.patientId, id: documents.id, docType: documents.docType, documentDate: documents.documentDate, receivedAt: documents.receivedAt,
      institutionName: documents.institutionName, sha256: documents.sha256, amendmentOf: documents.amendmentOf,
      duplicateOf: documents.duplicateOf, attachState: documents.attachState, attachDecidedAt: documents.attachDecidedAt, attachReason: documents.attachReason,
      identityResult: documents.identityResult, status: documents.status,
    }).from(documents).where(idIn(documents.patientId, ids)),
    tx.select({
      pid: patientStatements.patientId, id: patientStatements.id, questionId: patientStatements.questionId, answer: patientStatements.answer, transcript: patientStatements.transcript,
      language: patientStatements.language, confirmation: patientStatements.confirmation, createdAt: patientStatements.createdAt,
    }).from(patientStatements).where(idIn(patientStatements.patientId, ids)),
    tx.select({
      pid: missingRecords.patientId, ruleId: missingRecords.ruleId, ruleVersion: missingRecords.ruleVersion, mode: missingRecords.mode, triggerEventId: missingRecords.triggerEventId,
      expectedTypes: missingRecords.expectedTypes, state: missingRecords.state, dedupeKey: missingRecords.dedupeKey, matchWindow: missingRecords.matchWindow,
    }).from(missingRecords).where(idIn(missingRecords.patientId, ids)),
    tx.select({
      pid: verifications.patientId, eventId: verifications.eventId, action: verifications.action, toStatus: verifications.toStatus, role: verifications.role,
      at: verifications.at, viewedSource: verifications.viewedSource, actorName: staff.name,
    }).from(verifications).leftJoin(staff, eq(staff.id, verifications.actorId)).where(idIn(verifications.patientId, ids)),
  ])
  for (const e of evs) out.get(e.patientId)?.events.push(e)
  for (const { pid, ...r } of evd) out.get(pid)?.evidence.push(r)
  for (const { pid, ...r } of docs) out.get(pid)?.documents.push(r)
  for (const { pid, ...r } of stmts) out.get(pid)?.statements.push(r)
  for (const { pid, ...r } of miss) out.get(pid)?.missing.push(r)
  for (const { pid, ...r } of vers) out.get(pid)?.verifications.push(r)
  return out
}

export type SnapshotRow = typeof snapshots.$inferSelect

export async function latestSnapshot(tx: Tx, patientId: string): Promise<{ row: SnapshotRow; snapshot: Snapshot; summary: SnapshotSummary } | null> {
  const [r] = await tx.selectDistinctOn([snapshots.patientId], { s: snapshots, signer: staff.name }).from(snapshots).leftJoin(staff, eq(staff.id, snapshots.signerId))
    .where(idIs(snapshots.patientId, patientId)).orderBy(snapshots.patientId, desc(snapshots.seq)) // the newest one; DISTINCT ON instead of LIMIT, which would be a bind parameter
  if (!r) return null
  return { row: r.s, snapshot: JSON.parse(r.s.canonicalJson) as Snapshot, summary: snapshotSummary(r.s, r.signer) }
}

/** latestSnapshot for many patients: one query. */
export async function latestSnapshotsFor(tx: Tx, ids: string[]): Promise<Map<string, { row: SnapshotRow; snapshot: Snapshot; summary: SnapshotSummary }>> {
  const out = new Map<string, { row: SnapshotRow; snapshot: Snapshot; summary: SnapshotSummary }>()
  if (!ids.length) return out
  const rows = await tx.selectDistinctOn([snapshots.patientId], { s: snapshots, signer: staff.name }).from(snapshots).leftJoin(staff, eq(staff.id, snapshots.signerId))
    .where(idIn(snapshots.patientId, ids)).orderBy(snapshots.patientId, desc(snapshots.seq))
  for (const r of rows) out.set(r.s.patientId, { row: r.s, snapshot: JSON.parse(r.s.canonicalJson) as Snapshot, summary: snapshotSummary(r.s, r.signer) })
  return out
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
  const since = sql.raw(`'${new Date(Date.now() - VIEW_WINDOW_MS).toISOString()}'`)
  const target = sql<string>`coalesce(${auditLog.details}->>'eventId', ${auditLog.targetId})`
  const ids = eventIds?.length ? sql.join(eventIds.map(uuidLit), sql`, `) : null // no bind parameters: see idIs
  const rows = await tx.select({ id: target }).from(auditLog).where(sql`${idIs(auditLog.actorId, staffId)} and ${auditLog.at} > ${since} and ${auditLog.action} ilike '%view%'
    and (${auditLog.targetType} = 'event' or ${auditLog.details} ? 'eventId')
    ${ids ? sql`and (${auditLog.targetId} in (${ids}) or ${auditLog.details}->>'eventId' in (${ids}))` : sql``}`)
  return new Set(rows.map((r) => r.id).filter(Boolean))
}

/** Rows + last seal + this actor's recent source views → the ledger view. `now` may still be pending: it is awaited alongside the queries. */
export async function loadLedger(tx: Tx, patientId: string, actor: { staffId: string; role: string }, now: Date | Promise<Date>): Promise<LedgerView> {
  const [rows, prev, viewed, at] = await Promise.all([loadRecordRows(tx, patientId), latestSnapshot(tx, patientId), viewedEventIds(tx, actor.staffId), now])
  return buildLedgerView({ rows, prev: prev && { snapshot: prev.snapshot, summary: prev.summary }, role: actor.role, now: at.toISOString(), viewedByMe: viewed })
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
      tx.select({ h: evidence.quoteSha256, q: evidence.quote }).from(evidence).where(idIs(evidence.patientId, patientId)),
    ])
    const quoteByHash = new Map(quotes.filter((x) => x.h && x.q).map((x) => [x.h!, x.q!]))
    return { view: buildTimeline(JSON.parse(row.json) as Snapshot, { quoteByHash }, filters), asOf: pick, snapshots: snaps }
  }
  const rows = await loadRecordRows(tx, patientId)
  const { record, rowById } = assembleRecord(rows)
  const ledger = diffLedger(null, record, now.toISOString())
  const conflicts = new Set(ledger.conflicts.filter((c) => !isResolved(c, rowById)).flatMap((c) => [c.a.id, c.b.id]))
  // The live timeline shows each real event once; the copies stay listed under "Duplicates hidden" on What's new. Sealed copies are never touched.
  const hidden = new Set(ledger.duplicates_suppressed.ids)
  const shown = { ...record, events: record.events.filter((e) => !hidden.has(e.id)) }
  const quoteByHash = new Map(rows.evidence.filter((x) => x.quoteSha256 && x.quote).map((x) => [x.quoteSha256!, x.quote!]))
  return { view: buildTimeline(buildSnapshot(shown, now.toISOString()), { quoteByHash, conflicts }, filters), asOf: null, snapshots: snaps }
}
