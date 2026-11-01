// Snapshots and the Change Ledger (FR-LED-01..06, FR-ONB-03, FR-ID-06, FR-REQ-03). Pure and deterministic.
import { canonicalJson } from '../canonical'
import { istDate } from '../copy'
import { daysBetween, dateRange } from '../dates'
import { sha256Hex } from '../hash'
import type {
  CoreDocument,
  CoreEvent,
  CoreMissingItem,
  CoreStatement,
  DocType,
  EventFlag,
  EventType,
  MissingState,
  RequestState,
  VerificationStatus,
} from '../types'

// ---------- canonical JSON (client-safe module, re-exported) ----------
export { canonicalJson }

// ---------- snapshot ----------

/** Missing items as stored (CoreMissingItem) or straight from runRadar (no state → expected). */
export type MissingLike = Omit<CoreMissingItem, 'state'> & { state?: MissingState }

export interface LedgerRecord {
  patientId: string
  events: CoreEvent[]
  documents: CoreDocument[]
  statements: CoreStatement[]
  missing: MissingLike[]
}

export interface SnapshotEvent {
  id: string
  eventType: EventType
  fields: CoreEvent['fields']
  eventDate: string | null
  datePrecision: CoreEvent['datePrecision']
  documentDate: string | null
  receivedAt: string
  documentId: string | null
  sourceType: CoreEvent['sourceType']
  extractionMethod: CoreEvent['extractionMethod']
  verificationStatus: VerificationStatus
  /** Plain-language label: "Verified" | "Not yet verified" | "Disputed" (FR-ONB-03). */
  label: 'Verified' | 'Not yet verified' | 'Disputed'
  flags: EventFlag[]
  version: number
  supersedesId: string | null
  evidence: { documentId: string | null; pageNo: number | null; charStart: number | null; charEnd: number | null; quoteSha256: string }[]
}

export interface Snapshot {
  schema: 'snapshot.v1'
  patientId: string
  sealedAt: string
  verified: SnapshotEvent[]
  unverified: SnapshotEvent[]
  documents: { id: string; docType: DocType; documentDate: string | null; receivedAt: string; institution: string | null; sha256: string | null }[]
  missing: { dedupeKey: string; ruleId: string; ruleVersion: number; state: MissingState; expectedTypes: DocType[]; wording: { en: string; hi: string } }[]
  statements: { id: string; questionId: string; transcript: string; confirmation: CoreStatement['confirmation']; capturedAt: string }[]
}

const VERIFIED: VerificationStatus[] = ['verified_matches_source', 'edited']

/** Current, attached, non-rejected, non-superseded events. */
function currentEvents(record: Pick<LedgerRecord, 'events' | 'documents'>): CoreEvent[] {
  const detached = new Set(record.documents.filter((d) => d.detachedAt).map((d) => d.id))
  const superseded = new Set(record.events.map((e) => e.supersedesId).filter(Boolean) as string[])
  return record.events.filter((e) => e.verificationStatus !== 'rejected' && !superseded.has(e.id) && !(e.documentId && detached.has(e.documentId)))
}

const byDateThenId = <T extends { id: string }>(date: (x: T) => string | null) => (a: T, b: T) => {
  const da = date(a)
  const db = date(b)
  if (da !== db) return da === null ? 1 : db === null ? -1 : da < db ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
const eventDay = (e: CoreEvent) => e.eventDate ?? e.documentDate

const openMissing = (m: MissingLike) => m.mode !== 'shadow' && !['closed', 'dismissed'].includes(m.state ?? 'expected')

/** Builds the immutable snapshot JSON for sealing (FR-LED-01). Verified and unverified items are separate, labelled lists. */
export function buildSnapshot(record: LedgerRecord, sealedAt: string): Snapshot {
  const events = currentEvents(record)
  const toSnap = (e: CoreEvent): SnapshotEvent => ({
    id: e.id,
    eventType: e.eventType,
    fields: e.fields,
    eventDate: e.eventDate,
    datePrecision: e.datePrecision,
    documentDate: e.documentDate,
    receivedAt: e.receivedAt,
    documentId: e.documentId,
    sourceType: e.sourceType,
    extractionMethod: e.extractionMethod,
    verificationStatus: e.verificationStatus,
    label: VERIFIED.includes(e.verificationStatus) ? 'Verified' : e.verificationStatus === 'disputed' ? 'Disputed' : 'Not yet verified',
    flags: [...new Set(e.flags)].sort(),
    version: e.version,
    supersedesId: e.supersedesId ?? null,
    evidence: e.evidence
      .map((v) => ({ documentId: v.documentId, pageNo: v.pageNo, charStart: v.charStart, charEnd: v.charEnd, quoteSha256: v.quoteSha256 }))
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
  })
  const sorted = [...events].sort(byDateThenId(eventDay))
  return {
    schema: 'snapshot.v1',
    patientId: record.patientId,
    sealedAt,
    verified: sorted.filter((e) => VERIFIED.includes(e.verificationStatus)).map(toSnap),
    unverified: sorted.filter((e) => !VERIFIED.includes(e.verificationStatus)).map(toSnap),
    documents: record.documents
      .filter((d) => !d.detachedAt)
      .map((d) => ({ id: d.id, docType: d.docType, documentDate: d.documentDate, receivedAt: d.receivedAt, institution: d.institution ?? null, sha256: d.sha256 ?? null }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    missing: record.missing
      .filter(openMissing)
      .map((m) => ({ dedupeKey: m.dedupeKey, ruleId: m.ruleId, ruleVersion: m.ruleVersion, state: m.state ?? 'expected', expectedTypes: [...m.expectedTypes], wording: m.wording }))
      .sort((a, b) => (a.dedupeKey < b.dedupeKey ? -1 : 1)),
    statements: record.statements
      .map((s) => ({ id: s.id, questionId: s.questionId, transcript: s.transcript, confirmation: s.confirmation, capturedAt: s.capturedAt }))
      .sort(byDateThenId((s) => s.capturedAt)),
  }
}

/** SHA-256 (hex) of the canonical snapshot JSON. Any byte change changes the hash (FR-LED-01 tamper test). */
export const hashSnapshot = (s: Snapshot): string => sha256Hex(canonicalJson(s))

// ---------- ledger diff ----------

export const LEDGER_CATEGORIES = [
  'initial_record',
  'new_since_last_visit',
  'newly_received_older',
  'amended',
  'conflicts',
  'patient_said',
  'missing',
  'duplicates_suppressed',
  'errata',
] as const
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number]

export interface LedgerEventItem {
  category: 'initial_record' | 'new_since_last_visit' | 'newly_received_older' | 'amended'
  event: CoreEvent
  /** event.flags plus computed flags (late_received, conflict). */
  flags: EventFlag[]
  /** For amended items: the snapshot event this version replaces. */
  previousId?: string
}

export interface LedgerConflict {
  kind: 'procedure_date' | 'cycle_date' | 'medication_names'
  eventType: EventType
  field: 'event_date' | 'medication_names'
  a: { kind: 'event' | 'statement'; id: string; value: string }
  b: { kind: 'event' | 'statement'; id: string; value: string }
}

export interface LedgerErratum {
  documentId: string
  detachedAt: string | null
  withdrawnEventIds: string[]
}

export interface Ledger {
  mode: 'initial' | 'diff'
  sealedAt: string | null
  initial_record: LedgerEventItem[]
  new_since_last_visit: LedgerEventItem[]
  newly_received_older: LedgerEventItem[]
  amended: LedgerEventItem[]
  conflicts: LedgerConflict[]
  patient_said: CoreStatement[]
  missing: MissingLike[]
  duplicates_suppressed: { count: number; ids: string[] }
  errata: LedgerErratum[]
}

/** FR-ONB-01 backlog priority by source document type (administrative ordering of the initial record). */
export const ONBOARDING_PRIORITY: Record<DocType, number> = {
  pathology_report: 0,
  ihc_molecular_report: 0,
  imaging_report: 1,
  discharge_summary: 2,
  procedure_note: 2,
  chemo_daycare_record: 3,
  radiotherapy_summary: 3,
  prescription_printed: 4,
  prescription_handwritten: 4,
  lab_report: 5,
  consult_note: 6,
  bill_insurance: 6,
  other: 6,
}

export const CONFLICT_WINDOW_DAYS = 30

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
const fieldStr = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v))

function eventSignature(e: CoreEvent): string {
  const fields = Object.entries(e.fields).filter(([k]) => k !== 'institution_name')
  return canonicalJson({ t: e.eventType, d: e.eventDate, f: Object.fromEntries(fields.map(([k, v]) => [k, Array.isArray(v) ? v.map(norm).sort() : norm(String(v))])) })
}

function findConflicts(events: CoreEvent[], statements: CoreStatement[]): LedgerConflict[] {
  const out: LedgerConflict[] = []
  const pair = (type: EventType, key: (e: CoreEvent) => string | null, kind: LedgerConflict['kind']) => {
    const xs = events.filter((e) => e.eventType === type && e.eventDate && key(e)).sort((a, b) => (a.id < b.id ? -1 : 1))
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++) {
        const [a, b] = [xs[i], xs[j]]
        if (key(a) !== key(b) || a.eventDate === b.eventDate) continue
        if (Math.abs(daysBetween(a.eventDate!, b.eventDate!)) > CONFLICT_WINDOW_DAYS) continue
        out.push({ kind, eventType: type, field: 'event_date', a: { kind: 'event', id: a.id, value: a.eventDate! }, b: { kind: 'event', id: b.id, value: b.eventDate! } })
      }
  }
  // E-LED-04: same procedure, two different dates
  pair('procedure_documented', (e) => (e.fields.procedure_text ? norm(fieldStr(e.fields.procedure_text)) : null), 'procedure_date')
  // same cycle (and regimen when both state it) on two different dates
  pair('chemotherapy_session_documented', (e) => (e.fields.cycle_number !== undefined ? `${norm(fieldStr(e.fields.cycle_number))}|${e.fields.regimen_text ? norm(fieldStr(e.fields.regimen_text)) : ''}` : null), 'cycle_date')

  // E-LED-03: patient statement vs the latest prescription within the window
  const rx = events.filter((e) => e.eventType === 'prescription_documented' && Array.isArray(e.fields.medication_names) && eventDay(e))
  for (const s of [...statements].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!s.medicationNames?.length) continue
    const day = s.statedDate ?? istDate(s.capturedAt)
    const near = rx
      .filter((e) => Math.abs(daysBetween(eventDay(e)!, day)) <= CONFLICT_WINDOW_DAYS)
      .sort((a, b) => (eventDay(b)! < eventDay(a)! ? -1 : eventDay(b)! > eventDay(a)! ? 1 : a.id < b.id ? -1 : 1))[0]
    if (!near) continue
    const listed = new Set((near.fields.medication_names as string[]).map(norm))
    if (s.medicationNames.every((m) => listed.has(norm(m)))) continue
    out.push({
      kind: 'medication_names',
      eventType: 'prescription_documented',
      field: 'medication_names',
      a: { kind: 'statement', id: s.id, value: s.medicationNames.join(', ') },
      b: { kind: 'event', id: near.id, value: (near.fields.medication_names as string[]).join(', ') },
    })
  }
  return out
}

/**
 * Change Ledger: diff between the last sealed snapshot and the current record (FR-LED-02).
 * No snapshot → "initial record" mode (FR-LED-06). Lists are ordered by date (initial record: FR-ONB-01 document
 * priority, then date) — never by clinical importance.
 */
export function diffLedger(prev: Snapshot | null, current: LedgerRecord, now: string): Ledger {
  void now // categorisation depends only on the snapshot seal; `now` kept for the agreed signature
  const docById = new Map(current.documents.map((d) => [d.id, d]))
  const events = currentEvents(current).sort(byDateThenId(eventDay))

  // Duplicates: same type + date + fields (institution ignored), or from a duplicate document. Keep the earliest received.
  const dupIds: string[] = []
  const kept = new Map<string, CoreEvent>()
  for (const e of [...events].sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.id < b.id ? -1 : 1))) {
    const sig = eventSignature(e)
    if ((e.documentId && docById.get(e.documentId)?.duplicateOf) || kept.has(sig)) dupIds.push(e.id)
    else kept.set(sig, e)
  }
  const dup = new Set(dupIds)
  const live = events.filter((e) => !dup.has(e.id))

  const snapIds = new Set(prev ? [...prev.verified, ...prev.unverified].map((e) => e.id) : [])
  const snapDocs = new Set(prev ? prev.documents.map((d) => d.id) : [])
  const isNew = (e: CoreEvent) => !snapIds.has(e.id)

  const stmtById = new Map(current.statements.map((s) => [s.id, s]))
  const sideNew = (x: LedgerConflict['a']) => (x.kind === 'statement' ? stmtById.get(x.id)!.capturedAt > prev!.sealedAt : !snapIds.has(x.id))
  // Show a conflict when at least one side arrived after the last seal.
  const conflicts = findConflicts(live, current.statements).filter((c) => !prev || sideNew(c.a) || sideNew(c.b))
  const inConflict = new Set(conflicts.flatMap((c) => [c.a.id, c.b.id]))
  const item = (category: LedgerEventItem['category'], e: CoreEvent, extra: EventFlag[] = [], previousId?: string): LedgerEventItem => ({
    category,
    event: e,
    flags: [...new Set([...e.flags, ...extra, ...(inConflict.has(e.id) ? (['conflict'] as const) : [])])].sort(),
    ...(previousId ? { previousId } : {}),
  })

  const ledger: Ledger = {
    mode: prev ? 'diff' : 'initial',
    sealedAt: prev?.sealedAt ?? null,
    initial_record: [],
    new_since_last_visit: [],
    newly_received_older: [],
    amended: [],
    conflicts,
    patient_said: [],
    missing: current.missing.filter(openMissing).sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : a.dedupeKey < b.dedupeKey ? -1 : 1)),
    duplicates_suppressed: { count: dupIds.length, ids: [...dupIds].sort() },
    errata: [],
  }

  if (!prev) {
    const prio = (e: CoreEvent) => (e.documentId && docById.get(e.documentId) ? ONBOARDING_PRIORITY[docById.get(e.documentId)!.docType] : 7)
    ledger.initial_record = [...live].sort((a, b) => prio(a) - prio(b) || byDateThenId(eventDay)(a, b)).map((e) => item('initial_record', e))
    ledger.patient_said = [...current.statements].sort(byDateThenId((s) => s.capturedAt))
    return ledger
  }

  const sealedDay = istDate(prev.sealedAt)
  for (const e of live) {
    if (!isNew(e)) continue
    const amendedDoc = e.documentId ? docById.get(e.documentId)?.amendmentOf : null
    if ((e.supersedesId && snapIds.has(e.supersedesId)) || (amendedDoc && snapDocs.has(amendedDoc))) {
      ledger.amended.push(item('amended', e, [], e.supersedesId ?? undefined))
      continue
    }
    const day = eventDay(e)
    const start = day ? dateRange(day, e.eventDate ? e.datePrecision : 'day')[0] : null
    if (start && start > sealedDay) ledger.new_since_last_visit.push(item('new_since_last_visit', e))
    else ledger.newly_received_older.push(item('newly_received_older', e, ['late_received']))
  }
  ledger.patient_said = current.statements.filter((s) => s.capturedAt > prev.sealedAt).sort(byDateThenId((s) => s.capturedAt))

  // Errata (FR-ID-06): documents in the snapshot that have since been detached or removed.
  for (const d of prev.documents) {
    const cur = docById.get(d.id)
    if (cur && !cur.detachedAt) continue
    ledger.errata.push({
      documentId: d.id,
      detachedAt: cur?.detachedAt ?? null,
      withdrawnEventIds: [...prev.verified, ...prev.unverified].filter((e) => e.documentId === d.id).map((e) => e.id).sort(),
    })
  }
  return ledger
}

// ---------- bulk verify (FR-LED-05) ----------

export interface BulkCheckItem {
  flags: EventFlag[]
  category?: LedgerEventItem['category'] | string
  spanConfidence?: number | null
  verificationStatus?: VerificationStatus
}

/** "Verify all" is unavailable for conflicts, low OCR confidence, identity warnings, binding-uncertain or newly received older items. */
export function bulkVerifyEligible(item: BulkCheckItem): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = []
  const f = new Set(item.flags)
  if (f.has('conflict')) reasons.push('conflict')
  if (f.has('low_confidence') || (item.spanConfidence !== null && item.spanConfidence !== undefined && item.spanConfidence < 0.8)) reasons.push('low_confidence')
  if (f.has('identity_warning')) reasons.push('identity_warning')
  if (f.has('binding_uncertain')) reasons.push('binding_uncertain')
  // In initial-record mode (no prior snapshot) every backlog item is old by definition; the FR-LED-05 guard is for records that arrive after a seal.
  if (item.category === 'newly_received_older' || (f.has('late_received') && item.category !== 'initial_record')) reasons.push('newly_received_older')
  if (item.verificationStatus === 'disputed') reasons.push('disputed')
  return { eligible: reasons.length === 0, reasons }
}

// ---------- request tracking (FR-REQ-03) ----------

export const REMINDER_DAYS = 7
export const OPEN_DAYS = 21

/** drafted → sent → reminder_due (sent + 7 d) → open_21d (sent + 21 d); fulfilled / unobtainable / withdrawn are terminal. */
export function requestState(sentAt: string | null, now: string, fulfilledAt?: string | null, terminal?: 'unobtainable' | 'withdrawn' | null): RequestState {
  if (terminal) return terminal
  if (fulfilledAt) return 'fulfilled'
  if (!sentAt) return 'drafted'
  const days = (Date.parse(now) - Date.parse(sentAt)) / 86_400_000
  if (days >= OPEN_DAYS) return 'open_21d'
  if (days >= REMINDER_DAYS) return 'reminder_due'
  return 'sent'
}
