// Ledger read model + verification rules (FR-LED-02..07, FR-VER-01..03, FR-TML-01..04, FR-ONB-01).
// Pure and server-only (imports core/ledger → node:crypto): DB rows in, serialisable view models out.
import { formatDateIN, staffDocLabel } from '@/core/copy'
import { parseDate } from '@/core/dates'
import {
  buildSnapshot, bulkVerifyEligible, diffLedger, ONBOARDING_PRIORITY,
  type LedgerConflict, type LedgerEventItem, type LedgerRecord, type MissingLike, type Snapshot, type SnapshotEvent,
} from '@/core/ledger'
import {
  DOC_TYPES, EVENT_FIELDS, EVENT_FLAGS,
  type CoreDocument, type CoreEvent, type CoreStatement, type DocType, type EventFlag, type EventType, type FieldValue,
  type VerificationStatus,
} from '@/core/types'
import type { documents, events, evidence, missingRecords, patientStatements, verifications } from '@/db/schema'

// ── rows (what src/server/ledger/record.ts selects) ──────────────────────────
export type EventRow = typeof events.$inferSelect
export type EvidenceRow = Pick<typeof evidence.$inferSelect, 'eventId' | 'documentId' | 'pageNo' | 'charStart' | 'charEnd' | 'quote' | 'quoteSha256' | 'statementId'>
export type DocumentRow = Pick<typeof documents.$inferSelect,
  'id' | 'docType' | 'documentDate' | 'receivedAt' | 'institutionName' | 'sha256' | 'amendmentOf' | 'duplicateOf' | 'attachState' | 'attachDecidedAt' | 'identityResult' | 'status'>
export type StatementRow = Pick<typeof patientStatements.$inferSelect, 'id' | 'questionId' | 'answer' | 'transcript' | 'language' | 'confirmation' | 'createdAt'>
export type MissingRow = Pick<typeof missingRecords.$inferSelect, 'ruleId' | 'ruleVersion' | 'mode' | 'triggerEventId' | 'expectedTypes' | 'state' | 'dedupeKey' | 'matchWindow'>
export type VerificationRow = Pick<typeof verifications.$inferSelect, 'eventId' | 'action' | 'toStatus' | 'role' | 'at' | 'viewedSource'> & { actorName: string | null }
export type RecordRows = {
  patientId: string; events: EventRow[]; evidence: EvidenceRow[]; documents: DocumentRow[]; statements: StatementRow[]
  missing: MissingRow[]; verifications: VerificationRow[]
}

// ── labels ───────────────────────────────────────────────────────────────────
export const EVENT_LABEL: Record<EventType, string> = {
  document_received: 'Document received',
  procedure_documented: 'Procedure documented',
  pathology_report_documented: 'Pathology report documented',
  molecular_test_documented: 'Molecular test documented',
  imaging_report_documented: 'Imaging report documented',
  lab_report_documented: 'Lab report documented',
  prescription_documented: 'Prescription documented',
  chemotherapy_session_documented: 'Chemotherapy session documented',
  radiotherapy_documented: 'Radiotherapy documented',
  admission_documented: 'Admission documented',
  discharge_documented: 'Discharge documented',
  consultation_documented: 'Consultation documented',
  referral_documented: 'Referral documented',
  report_pending_documented: 'Report awaited (documented)',
  patient_statement: 'Patient statement',
}

export const FIELD_LABEL: Record<string, string> = {
  procedure_text: 'Procedure', institution_name: 'Institution', event_date_text: 'Date as written', test_name: 'Test',
  test_names: 'Tests', specimen_text: 'Specimen', accession_number: 'Accession no.', status_text: 'Status',
  medication_names: 'Medicines', prescriber_name: 'Prescriber', cycle_number: 'Cycle', regimen_text: 'Regimen',
  treatment_text: 'Treatment', doctor_name: 'Doctor', department_text: 'Department', referred_to_text: 'Referred to',
  document_title: 'Document', statement_text: 'Statement', scan_name: 'Scan', event_date: 'Date',
}

const QUESTION_LABEL: Record<string, string> = {
  other_hospital: 'Another hospital or doctor', new_medicines: 'New medicines', new_tests: 'New tests or scans',
  admissions: 'Hospital admissions', anything_else: 'Anything else',
}

const STATUS_LABEL: Record<VerificationStatus, string> = {
  unverified: 'Not yet verified', verified_matches_source: 'Verified · matches source', edited: 'Edited · original kept',
  rejected: 'Rejected', disputed: 'Disputed',
}

const HEADLINE_FIELDS = ['procedure_text', 'test_name', 'test_names', 'treatment_text', 'medication_names', 'referred_to_text', 'department_text', 'doctor_name', 'document_title', 'institution_name']

const isDocType = (t: string | null | undefined): t is DocType => !!t && (DOC_TYPES as readonly string[]).includes(t)
const FLAG_SET = new Set<string>(EVENT_FLAGS)
const fieldText = (v: FieldValue | unknown) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v))
const day = (iso: string | null, precision: CoreEvent['datePrecision'] = 'day') => formatDateIN(iso, 'en', precision)

export function headline(fields: Record<string, FieldValue>): string | null {
  const cycle = fields.cycle_number !== undefined ? `Cycle ${fields.cycle_number}` : null
  const regimen = fieldText(fields.regimen_text).trim()
  if (cycle || regimen) return [cycle, regimen].filter(Boolean).join(' · ')
  for (const k of HEADLINE_FIELDS) {
    const v = fieldText(fields[k]).trim()
    if (v) return v
  }
  return null
}

// ── mapping rows → core shapes ───────────────────────────────────────────────
export function toCoreDocument(d: DocumentRow): CoreDocument {
  return {
    id: d.id, docType: isDocType(d.docType) ? d.docType : 'other', documentDate: d.documentDate, receivedAt: d.receivedAt.toISOString(),
    institution: d.institutionName, title: isDocType(d.docType) ? staffDocLabel(d.docType) : 'Unclassified document', sha256: d.sha256,
    amendmentOf: d.amendmentOf, duplicateOf: d.duplicateOf,
    detachedAt: d.attachState === 'detached' ? (d.attachDecidedAt ?? d.receivedAt).toISOString() : null,
  }
}

export function fieldValues(f: Record<string, unknown>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  for (const [k, v] of Object.entries(f ?? {})) {
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v as string[]
  }
  return out
}

/** Stored flags (jsonb booleans + date flags) as EventFlag[]; a document attached without a header identity match adds identity_warning. */
export function eventFlags(e: Pick<EventRow, 'flags' | 'dateFlags'>, doc?: Pick<DocumentRow, 'identityResult'>): EventFlag[] {
  const s = new Set<EventFlag>()
  for (const [k, v] of Object.entries(e.flags ?? {})) if (v === true && FLAG_SET.has(k)) s.add(k as EventFlag)
  for (const k of e.dateFlags ?? []) if (FLAG_SET.has(k)) s.add(k as EventFlag)
  if (doc && doc.identityResult !== 'match') s.add('identity_warning')
  return [...s].sort()
}

export function toCoreEvent(e: EventRow, ev: EvidenceRow[], doc?: DocumentRow): CoreEvent {
  return {
    id: e.id, eventType: e.eventType, fields: fieldValues(e.fields), eventDate: e.eventDate, datePrecision: e.datePrecision,
    documentDate: e.documentDate ?? doc?.documentDate ?? null, receivedAt: e.receivedAt.toISOString(), documentId: e.documentId,
    sourceType: e.sourceType, extractionMethod: e.extractionMethod, verificationStatus: e.verificationStatus,
    flags: eventFlags(e, doc), version: e.version, supersedesId: e.supersedesId,
    evidence: ev.map((v) => ({
      documentId: v.documentId, pageNo: v.pageNo, charStart: v.charStart, charEnd: v.charEnd, quote: v.quote ?? '',
      quoteSha256: v.quoteSha256 ?? '', spanConfidence: null,
    })),
  }
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function toCoreStatement(s: StatementRow): CoreStatement {
  const a = (s.answer ?? {}) as Record<string, unknown>
  return {
    id: s.id, questionId: s.questionId, transcript: s.transcript ?? '', language: s.language ?? 'en',
    confirmation: s.confirmation === 'confirmed' || s.confirmation === 'corrected' ? 'patient_confirmed' : 'unconfirmed',
    capturedAt: s.createdAt.toISOString(), medicationNames: strings(a.medicationNames), scanNames: strings(a.scanNames),
    institutionName: typeof a.institutionName === 'string' ? a.institutionName : null,
    statedDate: typeof a.statedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.statedDate) ? a.statedDate : null,
  }
}

/** Radar wording is stored by the Pipeline's recomputeRadar in match_window.wording; a plain fallback otherwise. */
export function toMissing(m: MissingRow): MissingLike {
  const types = m.expectedTypes.filter(isDocType)
  const w = (m.matchWindow as { wording?: { en?: unknown; hi?: unknown } } | null)?.wording
  const wording = w && typeof w.en === 'string' && typeof w.hi === 'string' ? { en: w.en, hi: w.hi } : null
  return {
    dedupeKey: m.dedupeKey, ruleId: m.ruleId, ruleVersion: Number(m.ruleVersion) || 1, triggerEventId: m.triggerEventId ?? '',
    expectedTypes: types, state: m.state, mode: m.mode,
    wording: wording ?? { en: `${types.map(staffDocLabel).join(' or ') || 'Document'} not in file`, hi: `${types.map(staffDocLabel).join(' / ') || 'दस्तावेज़'} फ़ाइल में नहीं` },
  }
}

export type Assembled = {
  record: LedgerRecord
  rowById: Map<string, EventRow>
  docById: Map<string, DocumentRow>
  latest: Map<string, VerificationRow>
}

const ATTACHED = new Set(['auto', 'attached', 'detached'])
const UNUSABLE = new Set(['quarantined', 'failed'])

/**
 * The current record: events from attached documents (or none), not withdrawn; patient statements as statements.
 * Detached documents stay in (with detachedAt) so diffLedger can raise errata; core drops their events, and drops
 * rejected + superseded versions (latest version per chain).
 */
export function assembleRecord(rows: RecordRows): Assembled {
  const docs = rows.documents.filter((d) => ATTACHED.has(d.attachState) && !UNUSABLE.has(d.status))
  const docById = new Map(docs.map((d) => [d.id, d]))
  const evidenceBy = new Map<string, EvidenceRow[]>()
  for (const v of rows.evidence) evidenceBy.set(v.eventId, [...(evidenceBy.get(v.eventId) ?? []), v])
  const evRows = rows.events.filter((e) => !e.withdrawnAt && e.eventType !== 'patient_statement' && (!e.documentId || docById.has(e.documentId)))
  const coreEvents = evRows.map((e) => toCoreEvent(e, evidenceBy.get(e.id) ?? [], e.documentId ? docById.get(e.documentId) : undefined))
  const coreDocs = docs.map(toCoreDocument)
  const statements = rows.statements.map(toCoreStatement)
  const latest = new Map<string, VerificationRow>()
  for (const v of rows.verifications) {
    const cur = latest.get(v.eventId)
    if (!cur || v.at > cur.at) latest.set(v.eventId, v)
  }
  return {
    record: { patientId: rows.patientId, events: coreEvents, documents: coreDocs, statements, missing: rows.missing.map(toMissing) },
    rowById: new Map(evRows.map((e) => [e.id, e])),
    docById,
    latest,
  }
}

// ── tiers and permissions (FR-VER-02, FR-LED-05) ─────────────────────────────
export type Tier = 'records' | 'clinician'
export type Permit = true | string
export type VerifyAction = 'verify' | 'edit' | 'reject' | 'dispute'

/** Clinician tier by default (FR-VER-02): pathology/molecular/imaging report events and treatment events. */
export const CLINICIAN_TIER_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'pathology_report_documented', 'molecular_test_documented', 'imaging_report_documented',
  'procedure_documented', 'chemotherapy_session_documented', 'radiotherapy_documented',
])
const OLDER_CLINICIAN_DOCS: ReadonlySet<DocType> = new Set<DocType>(['pathology_report', 'ihc_molecular_report', 'imaging_report'])

export function tierOf(i: { eventType: EventType; flags: readonly EventFlag[]; category?: string; docType?: DocType | null }): Tier {
  if (CLINICIAN_TIER_TYPES.has(i.eventType)) return 'clinician'
  if (i.flags.includes('conflict')) return 'clinician'
  if (i.category === 'newly_received_older' && i.docType && OLDER_CLINICIAN_DOCS.has(i.docType)) return 'clinician'
  return 'records'
}

export function permitsFor(role: string, tier: Tier): Record<VerifyAction, Permit> {
  if (role !== 'records' && role !== 'clinician') {
    const no = 'Only records staff and clinicians verify items.'
    return { verify: no, edit: no, reject: no, dispute: no }
  }
  const ok: Permit = role === 'clinician' || tier === 'records' ? true : 'Clinician-tier item: a clinician verifies this one.'
  return { verify: ok, edit: ok, reject: ok, dispute: role === 'clinician' ? true : 'Only a clinician can mark an item disputed.' }
}

export const editableFields = (t: EventType) => EVENT_FIELDS[t].filter((f) => f !== 'event_date')

export type VerifyCheck = { status: number; code: string; message: string } | null

/** Role, tier, reason and field rules for one verification action (the API runs this before any write). */
export function checkVerification(i: { role: string; tier: Tier; action: VerifyAction; eventType: EventType; reason?: string | null; fields?: Record<string, unknown> | null }): VerifyCheck {
  const p = permitsFor(i.role, i.tier)[i.action]
  if (p !== true) return { status: 403, code: i.action !== 'dispute' && i.tier === 'clinician' && i.role === 'records' ? 'clinician_tier' : 'forbidden', message: p }
  if (i.action !== 'verify' && !i.reason?.trim()) return { status: 400, code: 'reason_required', message: 'A reason is required for edit, reject and dispute.' }
  if (i.action === 'edit') {
    const allowed = editableFields(i.eventType)
    const entries = Object.entries(i.fields ?? {})
    if (!entries.length) return { status: 400, code: 'invalid_fields', message: 'Give at least one corrected field.' }
    for (const [k, v] of entries) {
      if (!allowed.includes(k)) return { status: 400, code: 'invalid_fields', message: `${k} cannot be set on this event type.` }
      const empty = Array.isArray(v) ? !v.length || v.some((x) => typeof x !== 'string' || !x.trim()) : typeof v === 'string' ? !v.trim() : typeof v !== 'number'
      if (empty) return { status: 400, code: 'invalid_fields', message: `${k} needs a value.` }
    }
  }
  return null
}

const DATE_FLAGS = ['date_ambiguous', 'date_unknown', 'date_future']

/**
 * E-LED-05: an edit is a NEW event version (original kept). Edited values need not appear in the quote; each edited
 * field is marked `edited:<field>` in flags. A new date as written is re-parsed into event_date.
 */
export function editedVersion(old: EventRow, patch: Record<string, FieldValue>, actor: { staffId: string }, now: Date) {
  const fields: Record<string, unknown> = { ...old.fields }
  const flags: Record<string, boolean> = { ...old.flags }
  for (const [k, v] of Object.entries(patch)) {
    fields[k] = typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.map((x) => x.trim()) : v
    flags[`edited:${k}`] = true
  }
  let { eventDate, datePrecision, dateFlags } = old
  if (typeof patch.event_date_text === 'string') {
    const p = parseDate(patch.event_date_text, { now: now.toISOString() })
    eventDate = p.iso
    datePrecision = p.iso ? p.precision : 'unknown'
    dateFlags = p.iso ? [...p.flags] : [...new Set([...p.flags, 'date_unknown'])]
    for (const f of DATE_FLAGS) delete flags[f]
    for (const f of dateFlags) flags[f] = true
  }
  return {
    orgId: old.orgId, patientId: old.patientId, encounterId: old.encounterId, documentId: old.documentId, eventType: old.eventType,
    fields, eventDate, datePrecision, dateFlags, documentDate: old.documentDate, receivedAt: old.receivedAt, sourceType: old.sourceType,
    extractionMethod: old.extractionMethod, verificationStatus: 'edited' as const, flags, conflictGroup: old.conflictGroup,
    version: old.version + 1, supersedesId: old.id, rowVersion: 0, createdByKind: 'staff' as const, createdById: actor.staffId,
  }
}

// ── conflicts resolved by a clinician ────────────────────────────────────────
/** A clinician resolution is stored on each event side as flags[`resolved:<other side id>`] = true. */
export const resolvedKey = (otherId: string) => `resolved:${otherId}`

export function isResolved(c: LedgerConflict, rowById: Map<string, Pick<EventRow, 'flags'>>): boolean {
  const on = (side: LedgerConflict['a'], other: LedgerConflict['a']) => side.kind === 'event' && rowById.get(side.id)?.flags?.[resolvedKey(other.id)] === true
  return on(c.a, c.b) || on(c.b, c.a)
}

// ── view model ───────────────────────────────────────────────────────────────
export type SourceView = { documentId: string | null; docLabel: string; pageNo: number | null; quote: string; href: string | null }
export type FieldView = { key: string; label: string; value: string; edited: boolean }
export type ItemView = {
  id: string; rowVersion: number; category: LedgerEventItem['category']; eventType: EventType; typeLabel: string
  headline: string | null; status: VerificationStatus; statusLabel: string; flags: EventFlag[]; tier: Tier; version: number
  previousId: string | null; fields: FieldView[]; sources: SourceView[]
  who: { actorName: string | null; role: string | null; at: string | null; action: string | null }
  when: { event: string; eventIso: string | null; dateFrom: 'event' | 'document' | null; document: string | null; received: string }
  provenance: { sourceType: string; method: string; docType: DocType | null; institution: string | null }
  viewedSource: boolean
  bulk: { eligible: boolean; reasons: string[] }
  permits: Record<VerifyAction, Permit>
  editable: { key: string; label: string; value: string; list: boolean }[]
}
export type SideView = { kind: 'event' | 'statement'; id: string; value: string; title: string; sources: SourceView[]; transcript?: string; status?: VerificationStatus; rowVersion?: number }
export type ConflictView = { key: string; kind: LedgerConflict['kind']; label: string; sides: [SideView, SideView]; resolve: Permit }
export type StatementView = { id: string; question: string; transcript: string; confirmed: boolean; captured: string; medicines: string[]; scans: string[]; institution: string | null }
export type MissingView = { dedupeKey: string; title: string; state: MissingLike['state']; ruleId: string }
export type SnapshotSummary = { id: string; seq: number; sha256: string; sealedAt: string; sealedLabel: string; signerName: string | null; keyId: string | null; code: string }
export type LedgerView = {
  mode: 'initial' | 'diff'
  snapshot: SnapshotSummary | null
  role: string
  /** What the next seal will contain (FR-ONB-03: partial verification allowed, unverified labelled). */
  counts: { verified: number; unverified: number; disputed: number; documents: number; missing: number; statements: number }
  events: Record<LedgerEventItem['category'], ItemView[]>
  conflicts: ConflictView[]
  patientSaid: StatementView[]
  missing: MissingView[]
  duplicates: { count: number; items: { id: string; typeLabel: string; headline: string | null; date: string; docLabel: string }[] }
  errata: { documentId: string; docLabel: string; detached: string; withdrawn: number }[]
}

export const sourceHref = (patientId: string, documentId: string, eventId: string) => `/patients/${patientId}/documents/${documentId}?event=${eventId}`

function sourcesOf(patientId: string, e: Pick<CoreEvent, 'id' | 'evidence'>, docLabel: (id: string | null) => string): SourceView[] {
  return e.evidence.map((v) => ({
    documentId: v.documentId, docLabel: docLabel(v.documentId), pageNo: v.pageNo, quote: v.quote,
    href: v.documentId ? sourceHref(patientId, v.documentId, e.id) : null,
  }))
}

export type LedgerInput = {
  rows: RecordRows
  prev: { snapshot: Snapshot; summary: SnapshotSummary } | null
  role: string
  now: string
  /** Event ids whose source this actor opened in the last 30 min (FR-VER-03). */
  viewedByMe?: ReadonlySet<string>
}

/** The Change Ledger for one patient, ready to render (FR-LED-02/04/05/06). Never ordered by clinical importance. */
export function buildLedgerView({ rows, prev, role, now, viewedByMe }: LedgerInput): LedgerView {
  const a = assembleRecord(rows)
  const { record, rowById, docById, latest } = a
  const ledger = diffLedger(prev?.snapshot ?? null, record, now)
  const conflicts = ledger.conflicts.filter((c) => !isResolved(c, rowById))
  const inConflict = new Set(conflicts.flatMap((c) => [c.a.id, c.b.id]))
  const coreById = new Map(record.events.map((e) => [e.id, e]))
  const headlinesOnly = role === 'desk' // desk sees the ledger headline list only (PRD §6.1)
  const docType = (id: string | null) => (id ? docById.get(id)?.docType ?? null : null)
  const docLabel = (id: string | null) => {
    const t = docType(id)
    return id ? (isDocType(t) ? staffDocLabel(t) : 'Unclassified document') : 'No document'
  }

  const view = (it: LedgerEventItem): ItemView => {
    const e = it.event
    const row = rowById.get(e.id)!
    const dt = docType(e.documentId)
    const flags = [...new Set([...it.flags.filter((f) => f !== 'conflict'), ...(inConflict.has(e.id) || row.flags?.conflict === true ? (['conflict'] as const) : [])])].sort() as EventFlag[]
    const tier = tierOf({ eventType: e.eventType, flags, category: it.category, docType: isDocType(dt) ? dt : null })
    const v = latest.get(e.id)
    // The pipeline marks events whose date was taken from the document header (no date in the quote).
    const dateFrom = e.eventDate && !row.flags?.date_from_document ? 'event' : e.eventDate || e.documentDate ? 'document' : null
    return {
      id: e.id, rowVersion: row.rowVersion, category: it.category, eventType: e.eventType, typeLabel: EVENT_LABEL[e.eventType],
      headline: headlinesOnly ? null : headline(e.fields), status: e.verificationStatus, statusLabel: STATUS_LABEL[e.verificationStatus],
      flags, tier, version: e.version, previousId: it.previousId ?? e.supersedesId ?? null,
      fields: headlinesOnly ? [] : Object.entries(e.fields).filter(([k]) => k !== 'event_date').map(([k, val]) => ({ key: k, label: FIELD_LABEL[k] ?? k, value: fieldText(val), edited: row.flags?.[`edited:${k}`] === true })),
      sources: headlinesOnly ? [] : sourcesOf(rows.patientId, e, docLabel),
      who: { actorName: v?.actorName ?? null, role: v?.role ?? null, at: v ? day(v.at.toISOString()) : null, action: v?.action ?? null },
      when: {
        event: e.eventDate ? day(e.eventDate, e.datePrecision) : e.documentDate ? day(e.documentDate) : 'Date not stated',
        eventIso: e.eventDate ?? e.documentDate, dateFrom, document: e.documentDate ? day(e.documentDate) : null, received: day(e.receivedAt),
      },
      provenance: { sourceType: e.sourceType, method: e.extractionMethod, docType: isDocType(dt) ? dt : null, institution: e.documentId ? docById.get(e.documentId)?.institutionName ?? null : null },
      viewedSource: !!viewedByMe?.has(e.id) || (!!e.supersedesId && !!viewedByMe?.has(e.supersedesId)),
      bulk: bulkVerifyEligible({ flags, category: it.category, verificationStatus: e.verificationStatus }),
      permits: permitsFor(role, tier),
      editable: headlinesOnly ? [] : editableFields(e.eventType).map((k) => ({ key: k, label: FIELD_LABEL[k] ?? k, value: fieldText(e.fields[k]), list: k === 'medication_names' || k === 'test_names' })),
    }
  }

  const stmtById = new Map(record.statements.map((s) => [s.id, s]))
  const side = (x: LedgerConflict['a']): SideView => {
    if (x.kind === 'statement') {
      const s = stmtById.get(x.id)
      return { kind: 'statement', id: x.id, value: x.value, title: 'Patient said', sources: [], transcript: headlinesOnly ? undefined : s?.transcript }
    }
    const e = coreById.get(x.id)!
    return {
      kind: 'event', id: x.id, value: x.value, title: e ? `${docLabel(e.documentId)}${e.evidence[0]?.pageNo ? ` · p.${e.evidence[0].pageNo}` : ''}` : 'Event',
      sources: headlinesOnly || !e ? [] : sourcesOf(rows.patientId, e, docLabel), status: e?.verificationStatus, rowVersion: rowById.get(x.id)?.rowVersion,
    }
  }
  const CONFLICT_LABEL: Record<LedgerConflict['kind'], string> = {
    procedure_date: 'Two dates for one procedure', cycle_date: 'Two dates for one cycle', medication_names: 'Patient’s medicines differ from the nearest prescription',
  }

  const preview = buildSnapshot(record, now)
  const dupIds = new Set(ledger.duplicates_suppressed.ids)
  return {
    mode: ledger.mode,
    snapshot: prev?.summary ?? null,
    role,
    counts: {
      verified: preview.verified.length, unverified: preview.unverified.filter((e) => e.label !== 'Disputed').length,
      disputed: preview.unverified.filter((e) => e.label === 'Disputed').length, documents: preview.documents.length,
      missing: preview.missing.length, statements: preview.statements.length,
    },
    events: {
      initial_record: ledger.initial_record.map(view),
      new_since_last_visit: ledger.new_since_last_visit.map(view),
      newly_received_older: ledger.newly_received_older.map(view),
      amended: ledger.amended.map(view),
    },
    conflicts: conflicts.map((c) => ({
      key: `${c.a.id}:${c.b.id}`, kind: c.kind, label: CONFLICT_LABEL[c.kind], sides: [side(c.a), side(c.b)],
      resolve: role === 'clinician' ? true : 'A clinician resolves conflicts.',
    })),
    patientSaid: ledger.patient_said.map((s) => ({
      id: s.id, question: QUESTION_LABEL[s.questionId] ?? s.questionId, transcript: headlinesOnly ? '' : s.transcript,
      confirmed: s.confirmation === 'patient_confirmed', captured: day(s.capturedAt), medicines: headlinesOnly ? [] : s.medicationNames ?? [],
      scans: headlinesOnly ? [] : s.scanNames ?? [], institution: headlinesOnly ? null : s.institutionName ?? null,
    })),
    missing: ledger.missing.map((m) => ({ dedupeKey: m.dedupeKey, title: m.wording.en, state: m.state ?? 'expected', ruleId: m.ruleId })),
    duplicates: {
      count: ledger.duplicates_suppressed.count,
      items: record.events.filter((e) => dupIds.has(e.id)).map((e) => ({
        id: e.id, typeLabel: EVENT_LABEL[e.eventType], headline: headlinesOnly ? null : headline(e.fields),
        date: day(e.eventDate ?? e.documentDate, e.eventDate ? e.datePrecision : 'day'), docLabel: docLabel(e.documentId),
      })),
    },
    errata: ledger.errata.map((x) => ({
      documentId: x.documentId, docLabel: docLabel(x.documentId) === 'No document' ? 'Document' : docLabel(x.documentId),
      detached: x.detachedAt ? day(x.detachedAt) : 'removed', withdrawn: x.withdrawnEventIds.length,
    })),
  }
}

/** Ledger items by id (the API looks up tier, eligibility and current-ness here). */
export function itemsById(v: LedgerView): Map<string, ItemView> {
  return new Map(Object.values(v.events).flat().map((i) => [i.id, i]))
}

export function snapshotSummary(s: { id: string; seq: number; sha256: string; sealedAt: Date; keyId: string | null }, signerName: string | null): SnapshotSummary {
  const iso = s.sealedAt.toISOString()
  return {
    id: s.id, seq: s.seq, sha256: s.sha256, sealedAt: iso,
    sealedLabel: `${formatDateIN(iso)}, ${new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(11, 16)} IST`,
    signerName, keyId: s.keyId, code: `S${s.seq}·${s.sha256.slice(0, 6).toUpperCase()}`,
  }
}

// ── timeline (FR-TML-01..04) ─────────────────────────────────────────────────
export type TimelineFilters = { type?: string; inst?: string; source?: string; status?: string }
export type TimelineItem = {
  id: string; typeLabel: string; headline: string | null; status: VerificationStatus; label: SnapshotEvent['label']
  flags: EventFlag[]; conflict: boolean; dateIso: string | null; dateLabel: string; dateFrom: 'event' | 'document' | null
  docType: DocType | null; docLabel: string; institution: string | null; sourceType: string; sources: SourceView[]
}
export type TimelineView = {
  years: { year: string; months: { key: string; label: string; items: TimelineItem[] }[] }[]
  undated: TimelineItem[]
  facets: { types: { value: string; label: string }[]; institutions: string[]; sources: string[]; statuses: { value: string; label: string }[] }
  total: number
  shown: number
}

const STATUS_SLUG: Record<SnapshotEvent['label'], string> = { Verified: 'verified', 'Not yet verified': 'unverified', Disputed: 'disputed' }
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * The record as a corridor of dated placards. Works on a Snapshot so the live view (buildSnapshot of the current
 * record) and the as-of view (a sealed snapshot's canonical JSON) render the same way. Quotes come from evidence
 * rows by quote hash — a sealed snapshot holds hashes, never quotes.
 */
export function buildTimeline(snap: Snapshot, ctx: { quoteByHash: ReadonlyMap<string, string>; conflicts?: ReadonlySet<string> }, f: TimelineFilters = {}): TimelineView {
  const docs = new Map(snap.documents.map((d) => [d.id, d]))
  const all = [...snap.verified, ...snap.unverified].map((e): TimelineItem => {
    const d = e.documentId ? docs.get(e.documentId) : undefined
    const docLabel = d ? staffDocLabel(d.docType) : e.documentId ? 'Document' : 'No document'
    const dateIso = e.eventDate ?? e.documentDate
    const fields = e.fields as Record<string, FieldValue>
    return {
      id: e.id, typeLabel: EVENT_LABEL[e.eventType], headline: headline(fields), status: e.verificationStatus, label: e.label,
      flags: e.flags, conflict: !!ctx.conflicts?.has(e.id) || e.flags.includes('conflict'), dateIso,
      dateLabel: e.eventDate ? day(e.eventDate, e.datePrecision) : e.documentDate ? day(e.documentDate) : 'Date not stated',
      dateFrom: e.eventDate ? 'event' : e.documentDate ? 'document' : null, docType: d?.docType ?? null, docLabel,
      institution: d?.institution ?? (typeof fields.institution_name === 'string' ? fields.institution_name : null), sourceType: e.sourceType,
      sources: e.evidence.map((v) => ({
        documentId: v.documentId, docLabel, pageNo: v.pageNo, quote: ctx.quoteByHash.get(v.quoteSha256) ?? '',
        href: v.documentId ? sourceHref(snap.patientId, v.documentId, e.id) : null,
      })),
    }
  })
  const uniq = <T,>(xs: T[]) => [...new Set(xs)]
  const facets: TimelineView['facets'] = {
    types: uniq(all.map((i) => i.docType).filter(isDocType)).sort().map((t) => ({ value: t, label: staffDocLabel(t) })),
    institutions: uniq(all.map((i) => i.institution).filter((x): x is string => !!x)).sort(),
    sources: uniq(all.map((i) => i.sourceType)).sort(),
    statuses: (['Verified', 'Not yet verified', 'Disputed'] as const).filter((l) => all.some((i) => i.label === l)).map((l) => ({ value: STATUS_SLUG[l], label: l })),
  }
  const shown = all.filter((i) =>
    (!f.type || i.docType === f.type) && (!f.inst || i.institution === f.inst) && (!f.source || i.sourceType === f.source) && (!f.status || STATUS_SLUG[i.label] === f.status))
  const dated = shown.filter((i) => i.dateIso).sort((x, y) => (x.dateIso! < y.dateIso! ? -1 : x.dateIso! > y.dateIso! ? 1 : x.id < y.id ? -1 : 1))
  const years: TimelineView['years'] = []
  for (const i of dated) {
    const y = i.dateIso!.slice(0, 4)
    const m = i.dateIso!.slice(0, 7)
    let yr = years.at(-1)
    if (yr?.year !== y) years.push((yr = { year: y, months: [] }))
    let mo = yr.months.at(-1)
    if (mo?.key !== m) yr.months.push((mo = { key: m, label: MONTH[Number(m.slice(5, 7)) - 1], items: [] }))
    mo.items.push(i)
  }
  return { years, undated: shown.filter((i) => !i.dateIso), facets, total: all.length, shown: shown.length }
}

// ── records queue (FR-ONB-01) ────────────────────────────────────────────────
export const PRIORITY_BUCKETS = ['Pathology / molecular', 'Imaging reports', 'Discharge / procedure summaries', 'Treatment records', 'Prescriptions', 'Lab reports', 'Other'] as const
/** Onboarding bucket index for a source document type (no document → Other). */
export const priorityOf = (docType: string | null) => (isDocType(docType) ? ONBOARDING_PRIORITY[docType] : 6)

