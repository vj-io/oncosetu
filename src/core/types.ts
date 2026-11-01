// Shared enums and record shapes for OncoSetu core logic (PRD §7.2, §7.3, FR-DOC-04, FR-RAD-03, FR-REQ-03).
// Pure types + const arrays only: safe to import from client and server code.

export const EVENT_TYPES = [
  'document_received',
  'procedure_documented',
  'pathology_report_documented',
  'molecular_test_documented',
  'imaging_report_documented',
  'lab_report_documented',
  'prescription_documented',
  'chemotherapy_session_documented',
  'radiotherapy_documented',
  'admission_documented',
  'discharge_documented',
  'consultation_documented',
  'referral_documented',
  'report_pending_documented',
  'patient_statement',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** Event types a document extractor (LLM or pattern) may emit. `document_received` is system-made, `patient_statement` comes from VOX. */
export const EXTRACTABLE_EVENT_TYPES = EVENT_TYPES.filter(
  (t) => t !== 'document_received' && t !== 'patient_statement',
) as Exclude<EventType, 'document_received' | 'patient_statement'>[]
export type ExtractableEventType = Exclude<EventType, 'document_received' | 'patient_statement'>

/**
 * Per-event-type field allow-list (PRD §7.2: descriptive, quoted fields only).
 * Every value is verbatim text from the quote, except `cycle_number` (number or digits) and `event_date`
 * (may be ISO `YYYY-MM-DD`, accepted only if a raw date in the quote parses to it).
 * `event_date_text` is the date exactly as written. No stage/grade/response/progression/risk/dose fields — ever.
 */
export const EVENT_FIELDS: Record<EventType, readonly string[]> = {
  document_received: ['document_title', 'institution_name', 'event_date_text'],
  procedure_documented: ['procedure_text', 'institution_name', 'event_date_text', 'event_date'],
  pathology_report_documented: ['test_name', 'specimen_text', 'accession_number', 'institution_name', 'event_date_text', 'event_date'],
  molecular_test_documented: ['test_name', 'status_text', 'specimen_text', 'accession_number', 'institution_name', 'event_date_text', 'event_date'],
  imaging_report_documented: ['test_name', 'institution_name', 'event_date_text', 'event_date'],
  lab_report_documented: ['test_name', 'test_names', 'institution_name', 'event_date_text', 'event_date'],
  prescription_documented: ['medication_names', 'prescriber_name', 'institution_name', 'event_date_text', 'event_date'],
  chemotherapy_session_documented: ['cycle_number', 'regimen_text', 'institution_name', 'event_date_text', 'event_date'],
  radiotherapy_documented: ['treatment_text', 'status_text', 'institution_name', 'event_date_text', 'event_date'],
  admission_documented: ['institution_name', 'event_date_text', 'event_date'],
  discharge_documented: ['institution_name', 'event_date_text', 'event_date'],
  consultation_documented: ['doctor_name', 'department_text', 'institution_name', 'event_date_text', 'event_date'],
  referral_documented: ['referred_to_text', 'doctor_name', 'institution_name', 'event_date_text', 'event_date'],
  report_pending_documented: ['test_name', 'status_text', 'institution_name', 'event_date_text', 'event_date'],
  patient_statement: ['statement_text', 'medication_names', 'scan_name', 'institution_name', 'event_date_text'],
}

/** FR-DOC-04's 13 classes. */
export const DOC_TYPES = [
  'pathology_report',
  'ihc_molecular_report',
  'imaging_report',
  'lab_report',
  'prescription_printed',
  'prescription_handwritten',
  'discharge_summary',
  'consult_note',
  'chemo_daycare_record',
  'radiotherapy_summary',
  'procedure_note',
  'bill_insurance',
  'other',
] as const
export type DocType = (typeof DOC_TYPES)[number]

export const SOURCE_TYPES = [
  'patient_reported',
  'caregiver_reported',
  'external_document',
  'internal_document',
  'external_structured',
  'clinician_entered',
] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const EXTRACTION_METHODS = ['manual', 'text_layer', 'ocr_llm', 'structured_map', 'asr'] as const
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number]

export const VERIFICATION_STATUSES = ['unverified', 'verified_matches_source', 'edited', 'rejected', 'disputed'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const EVENT_FLAGS = [
  'patient_confirmed',
  'conflict',
  'low_confidence',
  'identity_warning',
  'date_ambiguous',
  'date_unknown',
  'date_future',
  'late_received',
  'binding_uncertain',
] as const
export type EventFlag = (typeof EVENT_FLAGS)[number]

export const DATE_PRECISIONS = ['day', 'month', 'year', 'unknown'] as const
export type DatePrecision = (typeof DATE_PRECISIONS)[number]

export const MISSING_STATES = ['expected', 'requested', 'received', 'closed', 'unobtainable', 'dismissed'] as const
export type MissingState = (typeof MISSING_STATES)[number]

export const REQUEST_STATES = ['drafted', 'sent', 'reminder_due', 'open_21d', 'fulfilled', 'unobtainable', 'withdrawn'] as const
export type RequestState = (typeof REQUEST_STATES)[number]

export const DISCLOSURES = ['cleared', 'not_cleared', 'unknown'] as const
export type Disclosure = (typeof DISCLOSURES)[number]

export const CONSENT_PURPOSES = ['store', 'ai', 'share', 'abdm', 'metrics'] as const
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export type Lang = 'en' | 'hi'

/** Field values an event may carry (all verbatim text, except cycle_number). */
export type FieldValue = string | number | string[]

export interface CoreEvidence {
  documentId: string | null
  pageNo: number | null
  charStart: number | null
  charEnd: number | null
  quote: string
  quoteSha256: string
  spanConfidence?: number | null
}

export interface CoreEvent {
  id: string
  eventType: EventType
  fields: Record<string, FieldValue>
  /** Calendar date `YYYY-MM-DD`; month/year precision uses the 1st of the month/January. */
  eventDate: string | null
  datePrecision: DatePrecision
  documentDate: string | null
  /** ISO timestamp. */
  receivedAt: string
  documentId: string | null
  sourceType: SourceType
  extractionMethod: ExtractionMethod
  verificationStatus: VerificationStatus
  flags: EventFlag[]
  version: number
  supersedesId?: string | null
  evidence: CoreEvidence[]
}

export interface CoreDocument {
  id: string
  docType: DocType
  documentDate: string | null
  datePrecision?: DatePrecision
  /** ISO timestamp. */
  receivedAt: string
  institution?: string | null
  /** Staff-facing title, e.g. "Discharge summary". */
  title?: string | null
  sha256?: string | null
  amendmentOf?: string | null
  duplicateOf?: string | null
  /** ISO timestamp; set when a wrongly attached document was detached (FR-ID-06). */
  detachedAt?: string | null
}

export type StatementQuestion = 'other_hospital' | 'new_medicines' | 'new_tests' | 'admissions' | 'anything_else'

export interface CoreStatement {
  id: string
  questionId: StatementQuestion | string
  /** Patient words verbatim (FR-VOX-07). */
  transcript: string
  language: Lang | string
  confirmation: 'patient_confirmed' | 'unconfirmed'
  /** ISO timestamp. */
  capturedAt: string
  /** Structured parts the patient tapped/said; all verbatim. */
  medicationNames?: string[]
  scanNames?: string[]
  institutionName?: string | null
  /** Stated date (`YYYY-MM-DD`) only if the patient gave an absolute date; relative phrases stay in the transcript. */
  statedDate?: string | null
}

export interface CoreMissingItem {
  dedupeKey: string
  ruleId: string
  ruleVersion: number
  triggerEventId: string
  expectedTypes: DocType[]
  state: MissingState
  wording: { en: string; hi: string }
  mode?: 'production' | 'shadow'
}
