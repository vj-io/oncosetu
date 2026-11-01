// Radar reconcile (FR-RAD-02/03/05, E-RAD-01..04): run the pure engine over the patient's record and merge the result
// into missing_records without ever overriding a person's decision. Call after any change to events or documents.
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents, events, evidence, missingRecords, patientStatements, recordRequests, ruleStates } from '@/db/schema'
import { runRadar, transitionMissing, type RadarOutput, type RuleMode } from '@/core/radar'
import { EVENT_FLAGS, type CoreDocument, type CoreEvent, type CoreStatement, type DocType, type EventFlag, type MissingState } from '@/core/types'
import { now } from '@/server/clock'

/** States a person set (or that follow a person's action): the engine never moves a row out of these. */
const HUMAN_STATES: MissingState[] = ['requested', 'closed', 'unobtainable', 'dismissed']

/** missing_records.dedupe_key is unique table-wide; the engine's key is per patient, so it is namespaced here. */
export const rowKey = (patientId: string, engineKey: string) => `${patientId}:${engineKey}`

/** The patient's current record in core shapes: attached, non-withdrawn events; attached documents; confirmed statements. */
export async function loadRecord(tx: Tx, patientId: string): Promise<{ events: CoreEvent[]; documents: CoreDocument[]; statements: CoreStatement[] }> {
  const docs = await tx.select().from(documents).where(and(
    eq(documents.patientId, patientId), inArray(documents.attachState, ['auto', 'attached']), notInArray(documents.status, ['quarantined', 'failed']),
  ))
  const docIds = new Set(docs.map((d) => d.id))
  const evs = (await tx.select().from(events).where(and(eq(events.patientId, patientId), isNull(events.withdrawnAt))))
    .filter((e) => !e.documentId || docIds.has(e.documentId))
  const evid = evs.length ? await tx.select().from(evidence).where(inArray(evidence.eventId, evs.map((e) => e.id))) : []
  const sts = await tx.select().from(patientStatements).where(and(eq(patientStatements.patientId, patientId), inArray(patientStatements.confirmation, ['confirmed', 'corrected'])))
  return {
    documents: docs.map((d) => ({
      id: d.id, docType: (d.docType ?? 'other') as DocType, documentDate: d.documentDate, datePrecision: 'day', receivedAt: d.receivedAt.toISOString(),
      institution: d.institutionName, sha256: d.sha256, amendmentOf: d.amendmentOf, duplicateOf: d.duplicateOf, detachedAt: null,
    })),
    events: evs.map((e) => ({
      id: e.id, eventType: e.eventType, fields: e.fields as CoreEvent['fields'], eventDate: e.eventDate, datePrecision: e.datePrecision,
      documentDate: e.documentDate, receivedAt: e.receivedAt.toISOString(), documentId: e.documentId, sourceType: e.sourceType,
      extractionMethod: e.extractionMethod, verificationStatus: e.verificationStatus,
      flags: (Object.entries(e.flags).filter(([k, v]) => v && (EVENT_FLAGS as readonly string[]).includes(k)).map(([k]) => k)) as EventFlag[],
      version: e.version, supersedesId: e.supersedesId,
      evidence: evid.filter((x) => x.eventId === e.id).map((x) => ({
        documentId: x.documentId, pageNo: x.pageNo, charStart: x.charStart, charEnd: x.charEnd, quote: x.quote ?? '', quoteSha256: x.quoteSha256 ?? '',
      })),
    })),
    statements: sts.map((s) => {
      const a = (s.answer ?? {}) as Record<string, unknown>
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
      return {
        id: s.id, questionId: s.questionId, transcript: s.transcript ?? '', language: s.language ?? 'en', confirmation: 'patient_confirmed',
        capturedAt: s.createdAt.toISOString(), medicationNames: list(a.medicationNames), scanNames: list(a.scanNames),
        institutionName: typeof a.institutionName === 'string' ? a.institutionName : null, statedDate: typeof a.statedDate === 'string' ? a.statedDate : null,
      }
    }),
  }
}

type MissingRow = Pick<typeof missingRecords.$inferSelect, 'id' | 'dedupeKey' | 'state' | 'proposedDocumentId'> & { matchWindow?: Record<string, unknown> | null }
/** Documents a person said are "not a match" for this item; the engine never proposes them again. */
const rejectedOf = (row?: MissingRow): string[] => (Array.isArray(row?.matchWindow?.rejectedDocumentIds) ? (row!.matchWindow!.rejectedDocumentIds as string[]) : [])
type RowValues = Pick<typeof missingRecords.$inferInsert, 'ruleId' | 'ruleVersion' | 'mode' | 'expectedTypes' | 'matchWindow' | 'triggerEventId' | 'grouped'>
export type MergeOp =
  | { op: 'insert'; dedupeKey: string; values: RowValues }
  | { op: 'update'; id: string; set: Partial<typeof missingRecords.$inferInsert> }
  | { op: 'delete'; id: string }

/**
 * Pure merge plan (unit-tested): engine output + current rows → operations.
 *   new item → insert `expected` (mode from the engine: the org's rule_states row wins, else the YAML default);
 *   matching document now in file → `received` + proposed_document_id (never auto-closed: a person confirms);
 *   requested / closed / unobtainable / dismissed rows are never moved by the engine;
 *   a `received` row whose proposal disappeared goes back to `requested` (open request) or `expected`;
 *   an `expected`/`received` row whose trigger disappeared (detached document, withdrawn event) is deleted unless a
 *   records request points at it.
 * `requests`: missing_records ids → whether any request row exists, and whether a non-withdrawn one does.
 */
export function planRadarMerge(
  patientId: string, rows: MissingRow[], out: RadarOutput, eventIds: Set<string>, requests: Map<string, { any: boolean; open: boolean }>,
): MergeOp[] {
  const ops: MergeOp[] = []
  const byKey = new Map(rows.map((r) => [r.dedupeKey, r]))
  const seen = new Set<string>()
  const stamp = { stateChangedAt: new Date(), stateChangedBy: null }
  for (const it of out.items) {
    const key = rowKey(patientId, it.dedupeKey)
    seen.add(key)
    const row = byKey.get(key)
    const rejected = rejectedOf(row)
    const values: RowValues = {
      ruleId: it.ruleId, ruleVersion: String(it.ruleVersion), mode: it.mode, expectedTypes: it.expectedTypes,
      matchWindow: { from: it.window.from, to: it.window.to, wording: it.wording, neutralWording: it.neutralWording, sourceLabel: it.sourceLabel, triggerKind: it.triggerKind, triggerId: it.triggerEventId, ...(rejected.length ? { rejectedDocumentIds: rejected } : {}) },
      triggerEventId: it.triggerKind === 'event' && eventIds.has(it.triggerEventId) ? it.triggerEventId : null, grouped: it.grouped?.cycles ?? [],
    }
    if (!row) ops.push({ op: 'insert', dedupeKey: key, values })
    else if (row.state === 'received') ops.push({ op: 'update', id: row.id, set: { ...values, state: requests.get(row.id)?.open ? 'requested' : 'expected', proposedDocumentId: null, ...stamp } })
    else ops.push({ op: 'update', id: row.id, set: values })
  }
  for (const p of out.closureProposals) {
    const key = rowKey(patientId, p.dedupeKey)
    seen.add(key)
    const row = byKey.get(key)
    if (!row) continue // satisfied from the start: nothing was ever missing
    if (rejectedOf(row).includes(p.documentId)) continue // a person already said this document is not a match
    if (row.state === 'received') {
      if (row.proposedDocumentId !== p.documentId) ops.push({ op: 'update', id: row.id, set: { proposedDocumentId: p.documentId, notes: p.note ?? null } })
      continue
    }
    if (row.state !== 'expected' && row.state !== 'requested') continue
    const t = transitionMissing(row.state, { type: 'receive', documentId: p.documentId })
    if (t.ok) ops.push({ op: 'update', id: row.id, set: { state: t.state, proposedDocumentId: p.documentId, notes: p.note ?? null, ...stamp } })
  }
  for (const row of rows) {
    if (seen.has(row.dedupeKey) || HUMAN_STATES.includes(row.state) || requests.get(row.id)?.any) continue
    ops.push({ op: 'delete', id: row.id })
  }
  return ops
}

/** Re-runs the Radar for one patient and applies planRadarMerge (inside withOrg). Serialised per patient. */
export async function recomputeRadar(tx: Tx, orgId: string, patientId: string): Promise<{ items: number; proposals: number }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'radar:' + patientId}, 0))`)
  const record = await loadRecord(tx, patientId)
  const modes = await tx.select({ ruleId: ruleStates.ruleId, mode: ruleStates.mode }).from(ruleStates).where(eq(ruleStates.orgId, orgId))
  const ruleModes: Record<string, RuleMode> = Object.fromEntries(modes.map((m) => [m.ruleId, m.mode]))
  const out = runRadar({ ...record, ruleModes, now: (await now(orgId)).toISOString() })
  const rows = await tx.select({ id: missingRecords.id, dedupeKey: missingRecords.dedupeKey, state: missingRecords.state, proposedDocumentId: missingRecords.proposedDocumentId, matchWindow: missingRecords.matchWindow })
    .from(missingRecords).where(eq(missingRecords.patientId, patientId))
  const reqs = rows.length ? await tx.select({ id: recordRequests.missingRecordId, state: recordRequests.state }).from(recordRequests)
    .where(inArray(recordRequests.missingRecordId, rows.map((r) => r.id))) : []
  const requests = new Map<string, { any: boolean; open: boolean }>()
  for (const r of reqs) {
    const cur = requests.get(r.id!) ?? { any: false, open: false }
    requests.set(r.id!, { any: true, open: cur.open || r.state !== 'withdrawn' })
  }
  for (const op of planRadarMerge(patientId, rows, out, new Set(record.events.map((e) => e.id)), requests)) {
    if (op.op === 'insert') await tx.insert(missingRecords).values({ orgId, patientId, dedupeKey: op.dedupeKey, state: 'expected', ...op.values }).onConflictDoNothing()
    else if (op.op === 'update') await tx.update(missingRecords).set(op.set).where(eq(missingRecords.id, op.id))
    else await tx.delete(missingRecords).where(eq(missingRecords.id, op.id))
  }
  return { items: out.items.length, proposals: out.closureProposals.length }
}
