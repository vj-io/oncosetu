// Completeness checklist (FR-RAD-03..06, E-RAD-01..04): the staff gallery wall of missing_records and the human
// transitions on them. Rows are created and re-proposed by the Pipeline's recomputeRadar; people move them here.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { RADAR_RULES, transitionMissing, type MissingAction } from '@/core/radar'
import { DOC_TYPES, type DatePrecision, type Disclosure, type DocType, type FieldValue, type MissingState } from '@/core/types'
import type { Tx } from '@/db'
import { auditLog, documents, events, evidence, missingRecords, patients, recordRequests, snapshots } from '@/db/schema'
import { radarMetrics } from '../admin/metrics-compute'
import type { AuditDetails } from '../audit'
import { now } from '../clock'
import { HttpError } from '../http'
import { assertPatientAccess } from '../patients'
import type { Session, StaffSession } from '../session'
import { groupedCycles, missingWording, type L2, type WordingTrigger } from './wording'

type MissingRow = typeof missingRecords.$inferSelect

export type DocBrief = { id: string; docType: DocType | null; documentDate: string | null; institution: string | null; receivedAt: string }

export type DescribedItem = {
  id: string; dedupeKey: string; ruleId: string; ruleVersion: string; mode: 'production' | 'shadow'; state: MissingState
  expectedTypes: DocType[]; window: { from: string | null; to: string | null }; cycles: number[]
  wording: L2; neutral: L2
  trigger: { eventId: string; documentId: string | null; pageNo: number | null; quote: string | null; institution: string | null; date: string | null; precision: DatePrecision } | null
  triggerDoc: DocBrief | null
  proposedDoc: DocBrief | null
  matchedDoc: DocBrief | null
  /** E-RAD-01: the proposed document comes from another institution than the trigger's. */
  institutionDiffers: boolean
  reason: string | null
  createdAt: string; stateChangedAt: string
}

const isL2 = (x: unknown): x is L2 => !!x && typeof (x as L2).en === 'string' && typeof (x as L2).hi === 'string'
const asDocType = (t: string | null): DocType | null => (t && (DOC_TYPES as readonly string[]).includes(t) ? (t as DocType) : null)
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !['the', 'of', 'and', 'pvt', 'ltd', 'private', 'limited'].includes(w)).join(' ')
/** Same normalisation as the radar engine's institution check. */
export function institutionsDiffer(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const x = words(a), y = words(b)
  return !!x && !!y && !(x === y || x.includes(y) || y.includes(x))
}

/** Wording, trigger evidence and documents for stored rows (one query per table, not per row). */
export async function describeRows(tx: Tx, rows: MissingRow[]): Promise<DescribedItem[]> {
  const eventIds = [...new Set(rows.map((r) => r.triggerEventId).filter((x): x is string => !!x))]
  const evs = eventIds.length ? await tx.select({
    id: events.id, eventType: events.eventType, fields: events.fields, eventDate: events.eventDate, datePrecision: events.datePrecision,
    documentDate: events.documentDate, documentId: events.documentId,
  }).from(events).where(inArray(events.id, eventIds)) : []
  const evi = eventIds.length ? await tx.select({ eventId: evidence.eventId, pageNo: evidence.pageNo, quote: evidence.quote })
    .from(evidence).where(inArray(evidence.eventId, eventIds)).orderBy(asc(evidence.createdAt), asc(evidence.id)) : []
  const firstEvidence = new Map<string, (typeof evi)[number]>()
  for (const e of evi) if (!firstEvidence.has(e.eventId)) firstEvidence.set(e.eventId, e)

  const docIds = [...new Set([...evs.map((e) => e.documentId), ...rows.flatMap((r) => [r.proposedDocumentId, r.matchedDocumentId])].filter((x): x is string => !!x))]
  const docRows = docIds.length ? await tx.select({
    id: documents.id, docType: documents.docType, documentDate: documents.documentDate, institution: documents.institutionName, receivedAt: documents.receivedAt,
  }).from(documents).where(inArray(documents.id, docIds)) : []
  const docs = new Map(docRows.map((d): [string, DocBrief] => [d.id, { ...d, docType: asDocType(d.docType), receivedAt: d.receivedAt.toISOString() }]))
  const evById = new Map(evs.map((e) => [e.id, e]))

  return rows.map((r) => {
    const e = r.triggerEventId ? evById.get(r.triggerEventId) : undefined
    const ev1 = e ? firstEvidence.get(e.id) : undefined
    const triggerDoc = e?.documentId ? docs.get(e.documentId) ?? null : null
    const fields = (e?.fields ?? {}) as Record<string, FieldValue>
    const wt: WordingTrigger | null = e ? {
      kind: 'event', fields, eventDate: e.eventDate, datePrecision: e.datePrecision, documentDate: e.documentDate,
      pageNo: ev1?.pageNo ?? null, docType: triggerDoc?.docType ?? null,
    } : null
    const expectedTypes = r.expectedTypes.map(asDocType).filter((x): x is DocType => !!x)
    const cycles = groupedCycles(r.grouped)
    // recomputeRadar may store runRadar's own sentences in match_window; otherwise rebuild them.
    const win = (r.matchWindow ?? {}) as { from?: unknown; to?: unknown; wording?: unknown; neutralWording?: unknown }
    const rebuilt = missingWording(r.ruleId, expectedTypes, wt, cycles)
    const wording = isL2(win.wording) ? win.wording : rebuilt.wording
    const neutral = isL2(win.neutralWording) ? win.neutralWording : rebuilt.neutral
    const institution = (typeof fields.institution_name === 'string' ? fields.institution_name : null) ?? triggerDoc?.institution ?? null
    const proposedDoc = r.proposedDocumentId ? docs.get(r.proposedDocumentId) ?? null : null
    return {
      id: r.id, dedupeKey: r.dedupeKey, ruleId: r.ruleId, ruleVersion: r.ruleVersion, mode: r.mode, state: r.state,
      expectedTypes, cycles, wording, neutral,
      window: { from: typeof win.from === 'string' ? win.from : null, to: typeof win.to === 'string' ? win.to : null },
      trigger: e ? {
        eventId: e.id, documentId: e.documentId, pageNo: ev1?.pageNo ?? null, quote: ev1?.quote ?? null, institution,
        date: e.eventDate ?? e.documentDate, precision: e.eventDate ? e.datePrecision : e.documentDate ? 'day' : 'unknown',
      } : null,
      triggerDoc, proposedDoc,
      matchedDoc: r.matchedDocumentId ? docs.get(r.matchedDocumentId) ?? null : null,
      institutionDiffers: !!r.notes?.includes('institution_differs') || institutionsDiffer(institution, proposedDoc?.institution ?? null),
      reason: r.reason, createdAt: r.createdAt.toISOString(), stateChangedAt: r.stateChangedAt.toISOString(),
    }
  })
}

/** Missing ids a request covers: the column plus `letter_payload.missingIds` (one letter may cover several items). */
export function requestMissingIds(r: { missingRecordId: string | null; letterPayload: Record<string, unknown> | null }): string[] {
  const more = Array.isArray(r.letterPayload?.missingIds) ? (r.letterPayload!.missingIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  return [...new Set([r.missingRecordId, ...more].filter((x): x is string => !!x))]
}

export type HistoryEntry = { at: string; role: string; action: string; from: string | null; to: string | null }

export type Completeness = {
  disclosure: Disclosure
  open: DescribedItem[]
  resolved: DescribedItem[]
  /** org_admin only: shadow-mode counts per rule (never the items). */
  shadow: { ruleId: string; n: number }[] | null
  history: Record<string, HistoryEntry[]>
  requests: Record<string, { id: string; state: string; institution: string }[]>
  metrics: ReturnType<typeof radarMetrics>
}

const OPEN: MissingState[] = ['expected', 'requested', 'received']

export async function loadCompleteness(tx: Tx, patientId: string, viewer: StaffSession): Promise<Completeness> {
  const rows = await tx.select().from(missingRecords).where(eq(missingRecords.patientId, patientId)).orderBy(asc(missingRecords.createdAt), asc(missingRecords.id))
  const prod = rows.filter((r) => r.mode === 'production')
  const items = await describeRows(tx, prod)

  const reqs = await tx.select({ id: recordRequests.id, state: recordRequests.state, institution: recordRequests.institution, missingRecordId: recordRequests.missingRecordId, letterPayload: recordRequests.letterPayload })
    .from(recordRequests).where(eq(recordRequests.patientId, patientId)).orderBy(desc(recordRequests.createdAt))
  const requests: Completeness['requests'] = {}
  for (const r of reqs) for (const m of requestMissingIds(r)) (requests[m] ??= []).push({ id: r.id, state: r.state, institution: r.institution })

  const hist = prod.length ? await tx.select({ at: auditLog.at, role: auditLog.actorRole, action: auditLog.action, targetId: auditLog.targetId, details: auditLog.details })
    .from(auditLog).where(and(eq(auditLog.targetType, 'missing_record'), inArray(auditLog.targetId, prod.map((r) => r.id)))).orderBy(asc(auditLog.seq)) : []
  const history: Completeness['history'] = {}
  for (const h of hist) {
    const d = h.details as { from?: string; to?: string; action?: string }
    ;(history[h.targetId!] ??= []).push({ at: h.at.toISOString(), role: h.role, action: d.action ?? h.action, from: d.from ?? null, to: d.to ?? null })
  }

  const sealed = await tx.select({ sealedAt: snapshots.sealedAt }).from(snapshots).where(eq(snapshots.patientId, patientId))
  const metrics = radarMetrics(
    rows.map((r) => ({ patientId, mode: r.mode, state: r.state, createdAt: r.createdAt, stateChangedAt: r.stateChangedAt, hasRequest: !!requests[r.id] })),
    new Map([[patientId, sealed.map((s) => s.sealedAt)]]),
  )

  let shadow: Completeness['shadow'] = null
  if (viewer.role === 'org_admin') {
    const counts = new Map<string, number>()
    for (const r of rows) if (r.mode === 'shadow' && OPEN.includes(r.state)) counts.set(r.ruleId, (counts.get(r.ruleId) ?? 0) + 1)
    shadow = RADAR_RULES.map((r) => ({ ruleId: r.id, n: counts.get(r.id) ?? 0 })).filter((x) => x.n > 0)
  }
  const [p] = await tx.select({ d: patients.disclosureStatus }).from(patients).where(eq(patients.id, patientId))
  return {
    disclosure: p?.d ?? 'unknown',
    open: items.filter((i) => OPEN.includes(i.state)),
    resolved: items.filter((i) => !OPEN.includes(i.state)),
    shadow, history, requests, metrics,
  }
}

// ── transitions ──────────────────────────────────────────────────────────────

export type TransitionInput = {
  action: 'request' | 'receive' | 'confirm' | 'reject_match' | 'unobtainable' | 'dismiss' | 'reopen'
  reason?: string
  documentId?: string
}

type Ctx = {
  db: Tx; session: Session
  audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}

const TERMINAL_REQ = ['fulfilled', 'unobtainable', 'withdrawn'] as const
const DONE: MissingState[] = ['closed', 'unobtainable', 'dismissed']

/**
 * After an item is resolved: every open request whose items are now all resolved becomes fulfilled (if any item
 * was closed with a document) or unobtainable. Returns the ids changed.
 */
export async function settleRequests(tx: Tx, orgId: string, patientId: string, missingId: string): Promise<string[]> {
  const reqs = await tx.select().from(recordRequests).where(and(
    eq(recordRequests.patientId, patientId),
    sql`(${recordRequests.missingRecordId} = ${missingId} or ${recordRequests.letterPayload}->'missingIds' @> ${JSON.stringify([missingId])}::jsonb)`,
  ))
  const changed: string[] = []
  const at = await now(orgId)
  for (const r of reqs) {
    if ((TERMINAL_REQ as readonly string[]).includes(r.state)) continue
    const ids = requestMissingIds(r)
    const items = await tx.select({ state: missingRecords.state, matched: missingRecords.matchedDocumentId, changedAt: missingRecords.stateChangedAt })
      .from(missingRecords).where(inArray(missingRecords.id, ids))
    if (!items.length || !items.every((i) => DONE.includes(i.state))) continue
    const closed = items.filter((i) => i.state === 'closed').sort((a, b) => +b.changedAt - +a.changedAt)
    await tx.update(recordRequests).set(closed.length
      ? { state: 'fulfilled', fulfilledAt: at, fulfilledDocumentId: closed[0].matched, updatedAt: at }
      : { state: 'unobtainable', updatedAt: at }).where(eq(recordRequests.id, r.id))
    changed.push(r.id)
  }
  return changed
}

/** Moves one production item through the FR-RAD-03 state machine (records/clinician). */
export async function transitionItem(ctx: Ctx, id: string, input: TransitionInput): Promise<{ state: MissingState; settledRequests: string[] }> {
  const [row] = await ctx.db.select().from(missingRecords).where(eq(missingRecords.id, id))
  if (!row || row.mode !== 'production') throw new HttpError(404, 'not_found', 'Not found') // shadow items are not shown (FR-RAD-05)
  await assertPatientAccess(ctx, row.patientId)

  let docId: string | null = null
  if (input.action === 'receive' || input.action === 'confirm') {
    docId = input.documentId ?? (input.action === 'confirm' ? row.proposedDocumentId : null)
    if (!docId) throw new HttpError(400, 'document_required', 'Choose the document that matches')
    const [d] = await ctx.db.select({ id: documents.id }).from(documents)
      .where(and(eq(documents.id, docId), eq(documents.patientId, row.patientId), sql`${documents.attachState} <> 'detached'`))
    if (!d) throw new HttpError(404, 'document_not_found', 'That document is not in this patient’s file')
  }
  let backTo: 'expected' | 'requested' = 'expected'
  if (input.action === 'reject_match') {
    const [open] = await ctx.db.select({ id: recordRequests.id }).from(recordRequests).where(and(
      eq(recordRequests.patientId, row.patientId), inArray(recordRequests.state, ['sent', 'reminder_due', 'open_21d']),
      sql`(${recordRequests.missingRecordId} = ${id} or ${recordRequests.letterPayload}->'missingIds' @> ${JSON.stringify([id])}::jsonb)`,
    )).limit(1)
    if (open) backTo = 'requested'
  }
  const reason = input.reason?.trim() ?? ''
  const action: MissingAction =
    input.action === 'receive' ? { type: 'receive', documentId: docId! }
      : input.action === 'reject_match' ? { type: 'reject_match', backTo }
        : input.action === 'unobtainable' || input.action === 'dismiss' ? { type: input.action, reason }
          : { type: input.action }
  const res = transitionMissing(row.state, action)
  if (!res.ok) {
    throw res.error === 'reason_required'
      ? new HttpError(400, 'reason_required', 'A reason is required')
      : new HttpError(409, 'invalid_transition', `This item cannot move from “${row.state}” that way`)
  }

  const at = await now(row.orgId)
  await ctx.db.update(missingRecords).set({
    state: res.state, stateChangedAt: at, stateChangedBy: ctx.session.kind === 'staff' ? ctx.session.staffId : null,
    ...(input.action === 'unobtainable' || input.action === 'dismiss' ? { reason: reason.slice(0, 500) } : {}),
    ...(input.action === 'receive' ? { proposedDocumentId: docId } : {}),
    ...(input.action === 'reject_match' ? { proposedDocumentId: null } : {}),
    ...(input.action === 'confirm' ? { matchedDocumentId: docId } : {}),
    ...(input.action === 'reopen' ? { reason: null } : {}),
  }).where(eq(missingRecords.id, id))
  const settled = DONE.includes(res.state) ? await settleRequests(ctx.db, row.orgId, row.patientId, id) : []
  await ctx.audit('missing.transition', 'missing_record', id, {
    patientId: row.patientId, action: input.action, from: row.state, to: res.state, ...(docId ? { documentId: docId } : {}),
  })
  for (const r of settled) await ctx.audit('request.settled', 'record_request', r, { patientId: row.patientId, missingId: id })
  return { state: res.state, settledRequests: settled }
}
