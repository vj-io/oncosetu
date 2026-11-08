// OncoSetu schema (PRD §7 + docs/ARCHITECTURE.md "Data model").
// Rules: every patient-scoped table carries org_id (RLS, see drizzle/0001_rls_roles.sql) and patient_id.
// PII lives only in *_enc columns (src/server/crypto.ts encryptField); equality lookups use *_hmac blind indexes.
import {
  bigint, boolean, customType, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, text,
  timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { InstitutionType } from '../core/types'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

// ── columns ──────────────────────────────────────────────────────────────────
const pk = () => uuid('id').primaryKey().$defaultFn(() => uuidv7()).defaultRandom()
const tsz = (name: string) => timestamp(name, { withTimezone: true })
const createdAt = () => tsz('created_at').notNull().defaultNow()
const orgId = () => uuid('org_id').notNull().references(() => organisations.id)
const patientId = () => uuid('patient_id').notNull().references(() => patients.id)

// ── enums (PRD §6.1, §7.2, §7.3, FR-VER-01, FR-RAD-03, FR-REQ-03, FR-CON-07) ─
export const staffRole = pgEnum('staff_role', ['desk', 'records', 'clinician', 'org_admin', 'auditor'])
export const sessionKind = pgEnum('session_kind', ['staff', 'patient', 'caregiver'])
export const actorKind = pgEnum('actor_kind', ['staff', 'patient', 'caregiver', 'system'])
export const sex = pgEnum('sex', ['female', 'male', 'other', 'unknown'])
export const disclosureStatus = pgEnum('disclosure_status', ['cleared', 'not_cleared', 'unknown'])
export const primaryContact = pgEnum('primary_contact', ['patient', 'caregiver'])
export const lang = pgEnum('lang', ['en', 'hi', 'hinglish'])
export const patientStatus = pgEnum('patient_status', ['active', 'merged', 'erasure_requested', 'inactive', 'erased'])
export const consentAction = pgEnum('consent_action', ['grant', 'update', 'withdraw'])
export const encounterType = pgEnum('encounter_type', ['onboarding', 'returning', 'between'])
export const docStatus = pgEnum('doc_status', [
  'queued', 'processing', 'done', 'needs_review', 'failed', 'quarantined', 'unreadable',
])
export const identityResult = pgEnum('identity_result', ['match', 'mismatch', 'insufficient', 'pending'])
export const attachState = pgEnum('attach_state', ['auto', 'pending_decision', 'attached', 'rejected', 'detached'])
export const fileKind = pgEnum('file_kind', ['original', 'page_image'])
export const eventType = pgEnum('event_type', [
  'document_received', 'procedure_documented', 'pathology_report_documented', 'molecular_test_documented',
  'imaging_report_documented', 'lab_report_documented', 'prescription_documented',
  'chemotherapy_session_documented', 'radiotherapy_documented', 'admission_documented',
  'discharge_documented', 'consultation_documented', 'referral_documented', 'report_pending_documented',
  'allergy_documented', 'follow_up_documented', 'lab_results_documented', 'diagnosis_documented', 'history_documented',
  'stage_documented', 'marker_results_documented', 'margins_documented', 'impression_documented', 'addendum_documented', 'regimen_documented',
  'patient_statement',
])
export const datePrecision = pgEnum('date_precision', ['day', 'month', 'year', 'unknown'])
export const sourceType = pgEnum('source_type', [
  'patient_reported', 'caregiver_reported', 'external_document', 'internal_document', 'external_structured',
  'clinician_entered',
])
export const extractionMethod = pgEnum('extraction_method', ['manual', 'text_layer', 'ocr_llm', 'structured_map', 'asr'])
export const verificationStatus = pgEnum('verification_status', [
  'unverified', 'verified_matches_source', 'edited', 'rejected', 'disputed',
])
export const verificationAction = pgEnum('verification_action', [
  'verify', 'edit', 'reject', 'dispute', 'resolve_conflict', 'reopen',
])
export const statementConfirmation = pgEnum('statement_confirmation', ['pending', 'confirmed', 'corrected', 'declined'])
export const missingState = pgEnum('missing_state', [
  'expected', 'requested', 'received', 'closed', 'unobtainable', 'dismissed',
])
export const ruleMode = pgEnum('rule_mode', ['production', 'shadow'])
export const requestState = pgEnum('request_state', [
  'drafted', 'sent', 'reminder_due', 'open_21d', 'fulfilled', 'unobtainable', 'withdrawn',
])
export const shareScope = pgEnum('share_scope', ['summary', 'summary_with_documents'])
export const outboxChannel = pgEnum('outbox_channel', ['sms', 'whatsapp'])
// simulated = no provider configured (demo); queued = handed to the provider step; sent = accepted by the provider; failed = refused.
export const outboxDelivery = pgEnum('outbox_delivery', ['simulated', 'queued', 'sent', 'failed'])
export const studyPhase = pgEnum('study_phase', ['baseline', 'shadow', 'live'])
export const impactRating = pgEnum('impact_rating', ['none', 'delayed_decision', 'repeat_test_ordered', 'visit_rescheduled'])
export const repeatTestReason = pgEnum('repeat_test_reason', ['unavailable', 'quality', 'clinical_need'])
export const mergeState = pgEnum('merge_state', ['requested', 'approved', 'executed', 'rejected'])

/** `team` (case discussion with a care team) was added later: rows written before it have no such key, which reads as off. */
export type ConsentPurposes = { store: boolean; ai: boolean; share: boolean; abdm: boolean; metrics: boolean; team?: boolean }
export type OrgFlags = {
  voice: boolean; tts: boolean; ai_extraction: boolean
  /** FR-VOX-03 shadow mode: recordings are transcribed and kept for staff evaluation; the transcript never fills an answer. */
  voice_shadow?: boolean
  /** FR-VOX-01: pre-visit questions in the order asked, each on or off (absent: all five, default order). */
  questions?: { id: string; on: boolean }[]
}
/** OCR word: text, confidence 0..1, char start/end in page text, optional bbox [x0,y0,x1,y1]. */
export type OcrWord = { t: string; c: number; s: number; e: number; b?: [number, number, number, number] }

// ── tenancy, staff, auth ─────────────────────────────────────────────────────
export const organisations = pgTable('organisations', {
  id: pk(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull().default('hospital'),
  abdmHfrId: text('abdm_hfr_id'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: createdAt(),
})

export const staff = pgTable('staff', {
  id: pk(),
  orgId: orgId(),
  role: staffRole('role').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(), // stored lower-cased
  passwordHash: text('password_hash').notNull(),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(true),
  totpLastStep: bigint('totp_last_step', { mode: 'number' }), // last accepted code's time step: a code is used once (0022)
  isDemo: boolean('is_demo').notNull().default(false),
  active: boolean('active').notNull().default(true),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: tsz('locked_until'),
  lastLoginAt: tsz('last_login_at'),
  createdAt: createdAt(),
}, (t) => [index('staff_org_idx').on(t.orgId)])

export const sessions = pgTable('sessions', {
  id: pk(),
  tokenHash: text('token_hash').notNull().unique(),
  kind: sessionKind('kind').notNull(),
  staffId: uuid('staff_id').references(() => staff.id),
  patientId: uuid('patient_id').references(() => patients.id),
  caregiverId: uuid('caregiver_id').references(() => caregivers.id),
  orgId: orgId(),
  createdAt: createdAt(),
  lastSeenAt: tsz('last_seen_at').notNull().defaultNow(),
  expiresAt: tsz('expires_at').notNull(),
  idleTimeoutS: integer('idle_timeout_s').notNull(),
  revokedAt: tsz('revoked_at'),
}, (t) => [index('sessions_caregiver_idx').on(t.caregiverId)])

export const otpChallenges = pgTable('otp_challenges', {
  id: pk(),
  phoneHmac: text('phone_hmac').notNull(),
  purpose: text('purpose').notNull().default('login'),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lockedUntil: tsz('locked_until'),
  expiresAt: tsz('expires_at').notNull(),
  consumedAt: tsz('consumed_at'),
  createdAt: createdAt(),
}, (t) => [index('otp_phone_idx').on(t.phoneHmac, t.createdAt)])

// ── patients, caregivers, consent ────────────────────────────────────────────
export const patients = pgTable('patients', {
  id: pk(),
  orgId: orgId(),
  oncosetuTokenHash: text('oncosetu_token_hash').notNull().unique(), // hmac(base32 token) — FR-ID-01
  tokenRevokedAt: tsz('token_revoked_at'),
  mrn: text('mrn'),
  abhaNumberEnc: text('abha_number_enc'),
  abhaHmac: text('abha_hmac'),
  abhaVerified: boolean('abha_verified').notNull().default(false),
  /** Set by a trigger from abha_hmac (0019): the cross-org person; read only through person_registered_elsewhere(). */
  personId: uuid('person_id'),
  nameEnc: text('name_enc').notNull(),
  dobEnc: text('dob_enc'),
  phoneEnc: text('phone_enc'),
  phoneHmac: text('phone_hmac'),
  identityHmac: text('identity_hmac'), // hmac(normalised name + dob) — duplicate detector E-ID-06
  sex: sex('sex').notNull().default('unknown'),
  minor: boolean('minor').notNull().default(false),
  deceased: boolean('deceased').notNull().default(false),
  disclosureStatus: disclosureStatus('disclosure_status').notNull().default('unknown'),
  primaryContact: primaryContact('primary_contact').notNull().default('patient'),
  disclosureSetBy: uuid('disclosure_set_by').references(() => staff.id),
  disclosureSetAt: tsz('disclosure_set_at'),
  preferredLanguage: lang('preferred_language').notNull().default('en'),
  status: patientStatus('status').notNull().default('active'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
}, (t) => [
  index('patients_org_idx').on(t.orgId),
  index('patients_phone_idx').on(t.phoneHmac),
  index('patients_abha_idx').on(t.abhaHmac),
  index('patients_identity_idx').on(t.identityHmac),
  unique('patients_org_mrn_uq').on(t.orgId, t.mrn),
])

export const patientAliases = pgTable('patient_aliases', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  nameEnc: text('name_enc').notNull(),
  nameHmac: text('name_hmac'),
  kind: text('kind').notNull().default('other'), // married | transliteration | other
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
}, (t) => [index('patient_aliases_patient_idx').on(t.patientId)])

export const caregivers = pgTable('caregivers', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  nameEnc: text('name_enc').notNull(),
  relation: text('relation').notNull(),
  phoneEnc: text('phone_enc').notNull(),
  phoneHmac: text('phone_hmac').notNull(),
  scope: jsonb('scope').$type<Record<string, boolean>>().notNull().default({}),
  isGuardian: boolean('is_guardian').notNull().default(false),
  active: boolean('active').notNull().default(true),
  revokedAt: tsz('revoked_at'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
}, (t) => [index('caregivers_patient_idx').on(t.patientId), index('caregivers_phone_idx').on(t.phoneHmac)])

/** Append-only: the latest row per patient is the current state (UPDATE/DELETE revoked from the app role). */
export const consents = pgTable('consents', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  action: consentAction('action').notNull(),
  purposes: jsonb('purposes').$type<ConsentPurposes>().notNull(),
  actorType: actorKind('actor_type').notNull(),
  actorId: uuid('actor_id'),
  method: text('method').notNull().default('self'), // self | desk_assisted (FR-CON-06)
  witnessedBy: uuid('witnessed_by').references(() => staff.id),
  noticeVersion: text('notice_version').notNull(),
  language: text('language').notNull(),
  recordedAt: tsz('recorded_at').notNull().defaultNow(),
}, (t) => [index('consents_patient_idx').on(t.patientId, t.recordedAt)])

export const encounters = pgTable('encounters', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  type: encounterType('type').notNull(),
  startedBy: uuid('started_by'),
  startedAt: tsz('started_at').notNull().defaultNow(),
  clientCapturedAt: tsz('client_captured_at'),
  sealedSnapshotId: uuid('sealed_snapshot_id'),
  closedAt: tsz('closed_at'),
  /** Opened offline by a records/clinician device (client UUIDv7, 0020); never the desk's verified visit (FR-ID-02). */
  offlineCreated: boolean('offline_created').notNull().default(false),
}, (t) => [index('encounters_patient_idx').on(t.patientId)])

// ── documents ────────────────────────────────────────────────────────────────
export const documents = pgTable('documents', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  encounterId: uuid('encounter_id').references(() => encounters.id),
  clientFileId: text('client_file_id'), // idempotency key from the client (offline queue)
  sha256: text('sha256').notNull(),
  phash: text('phash'),
  nearDupOf: uuid('near_dup_of'),
  duplicateOf: uuid('duplicate_of'),
  mime: text('mime').notNull(),
  pages: integer('pages'),
  sizeBytes: integer('size_bytes').notNull(),
  filenameEnc: text('filename_enc'),
  intakeRoute: text('intake_route').notNull(), // desk_capture | patient_upload | bulk_upload | forwarded | staff_upload
  uploadedByKind: actorKind('uploaded_by_kind').notNull(),
  uploadedById: uuid('uploaded_by_id'),
  receivedAt: tsz('received_at').notNull().defaultNow(),
  clientCapturedAt: tsz('client_captured_at'),
  stage: text('stage'),
  status: docStatus('status').notNull().default('queued'),
  lockedAt: tsz('locked_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'), // error code only
  identityResult: identityResult('identity_result').notNull().default('pending'),
  identityDetails: jsonb('identity_details').$type<Record<string, unknown>>(),
  attachState: attachState('attach_state').notNull().default('pending_decision'),
  attachDecidedBy: uuid('attach_decided_by'),
  attachDecidedAt: tsz('attach_decided_at'),
  attachReason: text('attach_reason'),
  docType: text('doc_type'),
  docTypeConfidence: real('doc_type_confidence'),
  language: text('language'),
  handwritten: boolean('handwritten'),
  quality: jsonb('quality').$type<Record<string, unknown>>(),
  lowConfidence: boolean('low_confidence').notNull().default(false),
  injectionFlag: boolean('injection_flag').notNull().default(false),
  amendmentOf: uuid('amendment_of'),
  documentDate: date('document_date'),
  institutionName: text('institution_name'),
  flags: jsonb('flags').$type<Record<string, unknown>>().notNull().default({}),
  manualTags: jsonb('manual_tags').$type<string[]>().notNull().default([]),
  processor: text('processor'),
  processorVersion: text('processor_version'),
  createdAt: createdAt(),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('documents_org_client_file_uq').on(t.orgId, t.clientFileId),
  index('documents_patient_idx').on(t.patientId),
  index('documents_patient_sha_idx').on(t.patientId, t.sha256),
  index('documents_status_idx').on(t.orgId, t.status),
])

export const documentFiles = pgTable('document_files', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  kind: fileKind('kind').notNull(),
  pageNo: integer('page_no'),
  mime: text('mime').notNull(),
  bytesEnc: bytea('bytes_enc').notNull(),
  dekWrapped: text('dek_wrapped').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  // FR-DOC-08 (0021): what made a page image; originals are immutable and never superseded (DB trigger).
  processor: text('processor'),
  processorVersion: text('processor_version'),
  supersededAt: tsz('superseded_at'),
  createdAt: createdAt(),
}, (t) => [index('document_files_doc_idx').on(t.documentId)])

export const documentPages = pgTable('document_pages', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  pageNo: integer('page_no').notNull(),
  text: text('text').notNull().default(''),
  words: jsonb('words').$type<OcrWord[]>(),
  ocrConfidence: real('ocr_confidence'),
  lowConfidence: boolean('low_confidence').notNull().default(false),
  processor: text('processor'),
  processorVersion: text('processor_version'),
  textHash: text('text_hash'),
  /** FR-DOC-08 (0021): set when a reprocess replaces this version; readers take rows where it is null. */
  supersededAt: tsz('superseded_at'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('document_pages_doc_page_uq').on(t.documentId, t.pageNo).where(sql`superseded_at is null`),
  index('document_pages_doc_idx').on(t.documentId),
])

// ── events, evidence, statements, verification ───────────────────────────────
export const events = pgTable('events', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  encounterId: uuid('encounter_id').references(() => encounters.id),
  documentId: uuid('document_id').references(() => documents.id),
  eventType: eventType('event_type').notNull(),
  fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
  eventDate: date('event_date'),
  datePrecision: datePrecision('date_precision').notNull().default('unknown'),
  dateFlags: jsonb('date_flags').$type<string[]>().notNull().default([]),
  documentDate: date('document_date'),
  receivedAt: tsz('received_at').notNull().defaultNow(),
  sourceType: sourceType('source_type').notNull(),
  extractionMethod: extractionMethod('extraction_method').notNull(),
  verificationStatus: verificationStatus('verification_status').notNull().default('unverified'),
  flags: jsonb('flags').$type<Record<string, boolean>>().notNull().default({}),
  conflictGroup: text('conflict_group'),
  withdrawnAt: tsz('withdrawn_at'),
  withdrawnReason: text('withdrawn_reason'),
  version: integer('version').notNull().default(1),
  supersedesId: uuid('supersedes_id'),
  rowVersion: integer('row_version').notNull().default(0), // optimistic concurrency
  createdByKind: actorKind('created_by_kind').notNull().default('system'),
  createdById: uuid('created_by_id'),
  createdAt: createdAt(),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
}, (t) => [
  index('events_patient_idx').on(t.patientId, t.eventDate),
  index('events_document_idx').on(t.documentId),
])

export const patientStatements = pgTable('patient_statements', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  encounterId: uuid('encounter_id').references(() => encounters.id),
  questionId: text('question_id').notNull(),
  audioId: uuid('audio_id'),
  answer: jsonb('answer').$type<Record<string, unknown>>(),
  transcript: text('transcript'),
  language: text('language'),
  readbackText: text('readback_text'),
  confirmation: statementConfirmation('confirmation').notNull().default('pending'),
  asrProvider: text('asr_provider'),
  asrModel: text('asr_model'),
  createdByKind: actorKind('created_by_kind').notNull(),
  createdById: uuid('created_by_id'),
  createdAt: createdAt(),
  confirmedAt: tsz('confirmed_at'),
}, (t) => [index('patient_statements_patient_idx').on(t.patientId)])

export const evidence = pgTable('evidence', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  eventId: uuid('event_id').notNull().references(() => events.id),
  documentId: uuid('document_id').references(() => documents.id),
  pageNo: integer('page_no'),
  charStart: integer('char_start'),
  charEnd: integer('char_end'),
  quote: text('quote'),
  quoteSha256: text('quote_sha256'),
  bbox: jsonb('bbox').$type<number[][]>(),
  statementId: uuid('statement_id').references(() => patientStatements.id),
  tStart: real('t_start'),
  tEnd: real('t_end'),
  fhirResourceRef: text('fhir_resource_ref'),
  createdAt: createdAt(),
}, (t) => [index('evidence_event_idx').on(t.eventId)])

/** Append-only (UPDATE/DELETE revoked from the app role). */
export const verifications = pgTable('verifications', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  eventId: uuid('event_id').notNull().references(() => events.id),
  action: verificationAction('action').notNull(),
  fromStatus: verificationStatus('from_status'),
  toStatus: verificationStatus('to_status').notNull(),
  actorKind: actorKind('actor_kind').notNull().default('staff'),
  actorId: uuid('actor_id').notNull(),
  role: text('role').notNull(),
  reason: text('reason'),
  viewedSource: boolean('viewed_source').notNull().default(false),
  at: tsz('at').notNull().defaultNow(),
}, (t) => [index('verifications_event_idx').on(t.eventId)])

/** Immutable (grants + trigger). */
export const snapshots = pgTable('snapshots', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  encounterId: uuid('encounter_id').references(() => encounters.id),
  seq: integer('seq').notNull(),
  canonicalJson: text('canonical_json').notNull(),
  sha256: text('sha256').notNull(),
  signature: text('signature'),
  keyId: text('key_id'),
  signerId: uuid('signer_id'),
  sealedAt: tsz('sealed_at').notNull().defaultNow(),
}, (t) => [unique('snapshots_patient_seq_uq').on(t.patientId, t.seq)])

// ── Radar, requests, sharing ─────────────────────────────────────────────────
export const missingRecords = pgTable('missing_records', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  ruleId: text('rule_id').notNull(),
  ruleVersion: text('rule_version').notNull(),
  mode: ruleMode('mode').notNull().default('shadow'),
  triggerEventId: uuid('trigger_event_id').references(() => events.id),
  expectedTypes: jsonb('expected_types').$type<string[]>().notNull(),
  matchWindow: jsonb('match_window').$type<Record<string, unknown>>(),
  state: missingState('state').notNull().default('expected'),
  matchedDocumentId: uuid('matched_document_id').references(() => documents.id),
  proposedDocumentId: uuid('proposed_document_id').references(() => documents.id),
  reason: text('reason'),
  notes: text('notes'),
  dedupeKey: text('dedupe_key').notNull().unique(),
  grouped: jsonb('grouped').$type<unknown[]>().notNull().default([]),
  stateChangedAt: tsz('state_changed_at').notNull().defaultNow(),
  stateChangedBy: uuid('state_changed_by'),
  createdAt: createdAt(),
}, (t) => [index('missing_records_patient_idx').on(t.patientId, t.state)])

export const recordRequests = pgTable('record_requests', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  missingRecordId: uuid('missing_record_id').references(() => missingRecords.id),
  institution: text('institution').notNull(),
  institutionType: text('institution_type').$type<InstitutionType>(), // FR-REQ-06; null = not recorded
  documents: jsonb('documents').$type<string[]>().notNull().default([]),
  dateRange: jsonb('date_range').$type<{ from?: string; to?: string }>(),
  lang: lang('lang').notNull().default('en'),
  letterPayload: jsonb('letter_payload').$type<Record<string, unknown>>(),
  state: requestState('state').notNull().default('drafted'),
  sentAt: tsz('sent_at'),
  reminder7SentAt: tsz('reminder_7_sent_at'),
  reminder21SentAt: tsz('reminder_21_sent_at'),
  fulfilledAt: tsz('fulfilled_at'),
  fulfilledDocumentId: uuid('fulfilled_document_id').references(() => documents.id),
  createdByKind: actorKind('created_by_kind').notNull(),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
}, (t) => [index('record_requests_patient_idx').on(t.patientId, t.state)])

/** id is a random v4 uuid (122 bits): it appears in the share URL. The AES key lives only in the URL fragment. */
export const shareLinks = pgTable('share_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: orgId(),
  patientId: patientId(),
  snapshotId: uuid('snapshot_id').references(() => snapshots.id),
  scope: shareScope('scope').notNull().default('summary'),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  expiresAt: tsz('expires_at').notNull(),
  passcodeHash: text('passcode_hash'),
  attempts: integer('attempts').notNull().default(0),
  lockedAt: tsz('locked_at'),
  revokedAt: tsz('revoked_at'),
  createdByKind: actorKind('created_by_kind').notNull(),
  createdById: uuid('created_by_id'),
  createdAt: createdAt(),
}, (t) => [index('share_links_patient_idx').on(t.patientId)])

export const shareViews = pgTable('share_views', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  shareLinkId: uuid('share_link_id').notNull().references(() => shareLinks.id),
  at: tsz('at').notNull().defaultNow(),
  ipHash: text('ip_hash'),
  userAgent: text('user_agent'),
  outcome: text('outcome').notNull().default('viewed'), // viewed | wrong_passcode | locked | expired | revoked
}, (t) => [index('share_views_link_idx').on(t.shareLinkId)])

// ── operations ───────────────────────────────────────────────────────────────
export const aiRuns = pgTable('ai_runs', {
  id: pk(),
  orgId: orgId(),
  patientId: uuid('patient_id').references(() => patients.id),
  documentId: uuid('document_id').references(() => documents.id),
  kind: text('kind').notNull(),
  provider: text('provider').notNull(),
  model: text('model'),
  promptId: text('prompt_id'),
  promptVersion: text('prompt_version'),
  schemaVersion: text('schema_version'),
  inputHash: text('input_hash'),
  outputHash: text('output_hash'),
  latencyMs: integer('latency_ms'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  outcome: text('outcome').notNull(),
  createdAt: createdAt(),
}, (t) => [index('ai_runs_doc_idx').on(t.documentId)])

/** Append-only, per-org hash chain: hash = sha256(prev_hash + canonical row). See src/server/audit.ts. */
export const auditLog = pgTable('audit_log', {
  id: pk(),
  orgId: orgId(),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  at: tsz('at').notNull(),
  actorId: uuid('actor_id'),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  requestId: text('request_id'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
}, (t) => [
  unique('audit_log_org_seq_uq').on(t.orgId, t.seq),
  index('audit_log_target_idx').on(t.orgId, t.targetType, t.targetId),
])

export const devices = pgTable('devices', {
  id: pk(),
  orgId: orgId(),
  label: text('label').notNull(),
  registeredBy: uuid('registered_by').references(() => staff.id),
  registeredAt: tsz('registered_at').notNull().defaultNow(),
  lastSeenAt: tsz('last_seen_at'),
  revokedAt: tsz('revoked_at'),
  wipedAt: tsz('wiped_at'),
})

/** SMS/WhatsApp record: always written (masked number + HMAC, never the number); delivered by src/server/outbox.ts when a provider is configured. */
export const outbox = pgTable('outbox', {
  id: pk(),
  orgId: orgId(),
  patientId: uuid('patient_id').references(() => patients.id),
  channel: outboxChannel('channel').notNull(),
  toMasked: text('to_masked').notNull(),
  toHmac: text('to_hmac').notNull(),
  templateKey: text('template_key').notNull(),
  body: text('body').notNull(),
  lang: lang('lang').notNull().default('en'),
  delivery: outboxDelivery('delivery').notNull().default('simulated'),
  providerMessageId: text('provider_message_id'),
  /** Short code only (`twilio_21211`, `http_503`, `timeout`): the provider's message text can quote the number. */
  deliveryError: text('delivery_error'),
  deliveryUpdatedAt: tsz('delivery_updated_at'),
  createdAt: createdAt(),
}, (t) => [index('outbox_to_idx').on(t.toHmac, t.createdAt)])

export const breakGlass = pgTable('break_glass', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  staffId: uuid('staff_id').notNull().references(() => staff.id),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
  expiresAt: tsz('expires_at').notNull(),
  /** FR-ID-10: an alert on /admin until an org_admin marks the grant reviewed (0019). */
  reviewedAt: tsz('reviewed_at'),
  reviewedBy: uuid('reviewed_by').references(() => staff.id),
}, (t) => [index('break_glass_lookup_idx').on(t.patientId, t.staffId, t.expiresAt)])

/** Consultation-level baseline measurement form (PRD §16.4). No PHI. */
export const measurementForms = pgTable('measurement_forms', {
  id: pk(),
  orgId: orgId(),
  encounterId: uuid('encounter_id').references(() => encounters.id),
  clinicianId: uuid('clinician_id').notNull().references(() => staff.id),
  consultationDate: date('consultation_date').notNull(),
  phase: studyPhase('phase').notNull(),
  firstVisit: boolean('first_visit').notNull().default(true),
  missingRecordPresent: boolean('missing_record_present').notNull(),
  missingRecordCount: integer('missing_record_count').notNull().default(0),
  impact: impactRating('impact').notNull().default('none'),
  repeatTestOrdered: boolean('repeat_test_ordered').notNull().default(false),
  repeatTestReason: repeatTestReason('repeat_test_reason'),
  prepMinutes: integer('prep_minutes'),
  createdAt: createdAt(),
})

export const orgSettings = pgTable('org_settings', {
  orgId: uuid('org_id').primaryKey().references(() => organisations.id),
  flags: jsonb('flags').$type<OrgFlags>().notNull().default({ voice: false, tts: false, ai_extraction: false }),
  demoClockOffsetS: integer('demo_clock_offset_s').notNull().default(0),
  retentionDays: integer('retention_days').notNull().default(3650),
  /** PRD §9.6 per-org daily LLM budget (India day), every provider. */
  llmDailyCalls: integer('llm_daily_calls').notNull().default(1000),
  llmDailyTokens: integer('llm_daily_tokens').notNull().default(10_000_000),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
})

export const ruleStates = pgTable('rule_states', {
  orgId: orgId(),
  ruleId: text('rule_id').notNull(),
  mode: ruleMode('mode').notNull().default('shadow'),
  reviewedBy: uuid('reviewed_by').references(() => staff.id),
  reviewedAt: tsz('reviewed_at'),
}, (t) => [primaryKey({ columns: [t.orgId, t.ruleId] })])

export const patientMerges = pgTable('patient_merges', {
  id: pk(),
  orgId: orgId(),
  survivorId: uuid('survivor_id').notNull().references(() => patients.id),
  duplicateId: uuid('duplicate_id').notNull().references(() => patients.id),
  requestedBy: uuid('requested_by').notNull().references(() => staff.id),
  approvedBy: uuid('approved_by').references(() => staff.id),
  state: mergeState('state').notNull().default('requested'),
  reason: text('reason'),
  createdAt: createdAt(),
  executedAt: tsz('executed_at'),
})

/** FR-VER-04: one second review per sampled `verifications` row (drizzle/0002). Append-only: no UPDATE/DELETE grant. */
export const verificationQaReviews = pgTable('verification_qa_reviews', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  verificationId: uuid('verification_id').notNull().unique().references(() => verifications.id),
  eventId: uuid('event_id').notNull().references(() => events.id),
  reviewerId: uuid('reviewer_id').notNull().references(() => staff.id),
  outcome: text('outcome').$type<'agree' | 'disagree'>().notNull(),
  reviewedAt: tsz('reviewed_at').notNull().defaultNow(),
})

/** §16.4 "which document types were referenced but absent" for a measurement form (drizzle/0002). */
export const measurementFormDocTypes = pgTable('measurement_form_doc_types', {
  id: pk(),
  orgId: orgId(),
  formId: uuid('form_id').notNull().references(() => measurementForms.id),
  docType: text('doc_type').notNull(),
})

/** J8 / PRD §10.5 (drizzle/0003). The app role may only insert and move `state` / `completed_at`; nothing here deletes data. */
export const erasureRequests = pgTable('erasure_requests', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  requestedByKind: text('requested_by_kind').$type<'patient' | 'caregiver' | 'staff'>().notNull(),
  requestedById: uuid('requested_by_id').notNull(),
  requestedAt: tsz('requested_at').notNull().defaultNow(),
  state: text('state').$type<'queued' | 'scheduled' | 'completed' | 'cancelled'>().notNull().default('queued'),
  eligibleAfter: tsz('eligible_after').notNull(),
  completedAt: tsz('completed_at'),
})

// ── inbound channels: email drop + WhatsApp (drizzle/0008, src/server/inbound/**) ─
/** An address staff verified in person (FR-ING-04). Never deleted by the app, only revoked. */
export const contactEmails = pgTable('contact_emails', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  caregiverId: uuid('caregiver_id').references(() => caregivers.id, { onDelete: 'cascade' }),
  emailEnc: text('email_enc').notNull(),
  emailHmac: text('email_hmac').notNull(),
  verifiedBy: uuid('verified_by').notNull().references(() => staff.id),
  verifiedAt: tsz('verified_at').notNull().defaultNow(),
  revokedAt: tsz('revoked_at'),
})

/** The patient's drop address `<aliasToken>@INBOUND_EMAIL_DOMAIN`; one active per patient. */
export const inboundAliases = pgTable('inbound_aliases', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  aliasToken: text('alias_token').notNull().unique(),
  createdBy: uuid('created_by').references(() => staff.id),
  createdAt: createdAt(),
  revokedAt: tsz('revoked_at'),
})

/** WhatsApp files waiting for the sender's code (FR-ING-05). One open hold per (patient, channel, sender). */
export const inboundHolds = pgTable('inbound_holds', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  channel: text('channel').$type<'whatsapp'>().notNull(),
  senderHmac: text('sender_hmac').notNull(),
  /** Filled by the release: the documents it created. */
  documentIds: uuid('document_ids').array().notNull().default([]),
  codeHash: text('code_hash'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: tsz('expires_at').notNull(),
  releasedAt: tsz('released_at'),
  createdAt: createdAt(),
})

/** Held files, encrypted like document_files; they become documents only when the hold is released. */
export const inboundHoldFiles = pgTable('inbound_hold_files', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  holdId: uuid('hold_id').notNull().references(() => inboundHolds.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull(),
  bytesEnc: bytea('bytes_enc').notNull(),
  dekWrapped: text('dek_wrapped').notNull(),
  size: integer('size').notNull(),
  createdAt: createdAt(),
})

// ── ABDM HIU (drizzle/0009, src/server/abdm/**) ──────────────────────────────
export type AbdmRequestState = 'REQUESTED' | 'GRANTED' | 'DENIED' | 'EXPIRED' | 'REVOKED'
/** The consent artefact as stored: the CM's artefact with the patient's ABHA replaced by its blind index. */
export type AbdmArtefact = {
  consentId: string; status: 'GRANTED' | 'DENIED' | 'EXPIRED' | 'REVOKED'; patientHmac: string; hipId: string | null
  hiTypes: ('DiagnosticReport' | 'DischargeSummary' | 'OPConsultation' | 'Prescription')[]; dateRange: { from: string; to: string }
  dataEraseAt: string; grantedAt: string
}
/** One HIU consent request (FR-ING-ABDM-01). Deleted only through abdm_erase() / patient erasure. */
export const abdmConsentRequests = pgTable('abdm_consent_requests', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  requestedBy: uuid('requested_by').notNull().references(() => staff.id),
  hiTypes: text('hi_types').array().notNull(),
  dateFrom: date('date_from').notNull(),
  dateTo: date('date_to').notNull(),
  purpose: text('purpose').notNull().default('CAREMGT'),
  state: text('state').$type<AbdmRequestState>().notNull().default('REQUESTED'),
  gatewayRequestId: text('gateway_request_id'),
  consentRequestId: text('consent_request_id'),
  artefactId: text('artefact_id'),
  artefact: jsonb('artefact').$type<AbdmArtefact>(),
  eraseAt: tsz('erase_at').notNull(),
  decidedAt: tsz('decided_at'),
  erasedAt: tsz('erased_at'),
  createdAt: createdAt(),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
})

/** One health-information request + data push. Key material: SHA-256 hashes only. */
export const abdmTransfers = pgTable('abdm_transfers', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  consentRequestId: uuid('consent_request_id').notNull().references(() => abdmConsentRequests.id),
  transactionId: text('transaction_id'),
  hiuKeySha256: text('hiu_key_sha256').notNull(),
  hiuNonceSha256: text('hiu_nonce_sha256').notNull(),
  hipKeySha256: text('hip_key_sha256'),
  hipNonceSha256: text('hip_nonce_sha256'),
  state: text('state').$type<'REQUESTED' | 'TRANSFERRED' | 'FAILED' | 'ERASED'>().notNull().default('REQUESTED'),
  /** Short code only (consent gate refusal, decrypt_failed, checksum_mismatch, gateway error). */
  failure: text('failure'),
  entriesCount: integer('entries_count').notNull().default(0),
  documentIds: uuid('document_ids').array().notNull().default([]),
  requestedAt: tsz('requested_at').notNull().defaultNow(),
  receivedAt: tsz('received_at'),
})

/** Tables under ENABLE + FORCE RLS (org_id = app.org_id). Kept in sync with drizzle/0001_rls_roles.sql and later migrations. */
export const RLS_TABLES = [
  'patients', 'patient_aliases', 'caregivers', 'consents', 'encounters', 'documents', 'document_files',
  'document_pages', 'events', 'evidence', 'patient_statements', 'verifications', 'snapshots', 'missing_records',
  'record_requests', 'share_links', 'share_views', 'ai_runs', 'audit_log', 'devices', 'outbox', 'break_glass',
  'measurement_forms', 'rule_states', 'patient_merges',
  'verification_qa_reviews', 'measurement_form_doc_types', // 0002
  'erasure_requests', // 0003
  'contact_emails', 'inbound_aliases', 'inbound_holds', 'inbound_hold_files', // 0008
  'abdm_consent_requests', 'abdm_transfers', // 0009
  'privacy_acknowledgements', 'id_verifications', // 0014
  'upload_sessions', 'upload_chunks', // 0015
  'signed_consents', // 0016
] as const

// ── privacy, ID and chunked uploads (0014, 0015) ─────────────────────────────
export const privacyAcknowledgements = pgTable('privacy_acknowledgements', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  actorType: text('actor_type').$type<'patient' | 'caregiver'>().notNull(),
  actorId: uuid('actor_id').notNull(),
  noticeVersion: text('notice_version').notNull(),
  language: text('language').notNull(),
  acknowledgedAt: tsz('acknowledged_at').notNull().defaultNow(),
}, (t) => [index('privacy_ack_patient_idx').on(t.patientId, t.acknowledgedAt)])

export const ID_TYPES = ['aadhaar', 'abha', 'pan', 'voter_id', 'passport', 'driving_licence'] as const
export type IdType = (typeof ID_TYPES)[number]

export const idVerifications = pgTable('id_verifications', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  idType: text('id_type').$type<IdType>().notNull(),
  last4: text('last4').notNull(), // the ONLY part of an ID that is ever stored
  verifiedBy: uuid('verified_by').notNull().references(() => staff.id),
  verifiedAt: tsz('verified_at').notNull().defaultNow(),
  revokedAt: tsz('revoked_at'),
}, (t) => [index('id_verifications_patient_idx').on(t.patientId, t.verifiedAt)])

export const uploadSessions = pgTable('upload_sessions', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  uploaderKind: text('uploader_kind').$type<'staff' | 'patient' | 'caregiver'>().notNull(),
  uploaderId: uuid('uploader_id').notNull(),
  fileNameEnc: text('file_name_enc'),
  totalSize: bigint('total_size', { mode: 'number' }).notNull(),
  totalChunks: integer('total_chunks').notNull(),
  sha256: text('sha256').notNull(),
  intakeRoute: text('intake_route').notNull(),
  encounterId: uuid('encounter_id'),
  clientFileId: text('client_file_id'), // offline queue: idempotency key, passed to intake when the file is assembled (0020)
  clientCapturedAt: tsz('client_captured_at'),
  state: text('state').$type<'open' | 'done' | 'aborted'>().notNull().default('open'),
  createdAt: createdAt(),
  expiresAt: tsz('expires_at').notNull(),
})

export const uploadChunks = pgTable('upload_chunks', {
  id: pk(),
  orgId: orgId(),
  sessionId: uuid('session_id').notNull().references(() => uploadSessions.id, { onDelete: 'cascade' }),
  idx: integer('idx').notNull(),
  bytesEnc: bytea('bytes_enc').notNull(),
  dekWrapped: text('dek_wrapped').notNull(),
  size: integer('size').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('upload_chunks_session_idx_uq').on(t.sessionId, t.idx)])

/** Voice answers, encrypted, kept beside the statement they became (FR-VOX-05, 0018). Erased with the patient. */
export const voiceClips = pgTable('voice_clips', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  statementId: uuid('statement_id'),
  /** A desk audio note of this encounter (0020); null for a voice answer. */
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  seconds: integer('seconds').notNull().default(0),
  bytesEnc: bytea('bytes_enc').notNull(),
  dekWrapped: text('dek_wrapped').notNull(),
  asrProvider: text('asr_provider').notNull(),
  asrModel: text('asr_model').notNull(),
  createdByKind: text('created_by_kind').notNull(),
  createdById: uuid('created_by_id').notNull(),
  createdAt: createdAt(),
}, (t) => [index('voice_clips_patient_idx').on(t.patientId, t.createdAt), index('voice_clips_statement_idx').on(t.statementId), index('voice_clips_encounter_idx').on(t.encounterId)])

export const signedConsents = pgTable('signed_consents', {
  id: pk(),
  orgId: orgId(),
  patientId: patientId(),
  consentId: uuid('consent_id').references(() => consents.id),
  action: text('action').$type<'grant' | 'update' | 'withdraw'>().notNull(),
  formVersion: text('form_version').notNull(),
  signerNameEnc: text('signer_name_enc'),
  signerRelation: text('signer_relation').$type<'self' | 'guardian' | 'caregiver'>().notNull(),
  method: text('method').$type<'drawn' | 'typed'>().notNull(),
  witnessStaffId: uuid('witness_staff_id').references(() => staff.id),
  signedAt: tsz('signed_at').notNull().defaultNow(),
  language: text('language').notNull(),
  purposes: jsonb('purposes').$type<ConsentPurposes>().notNull(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
}, (t) => [index('signed_consents_patient_idx').on(t.patientId, t.signedAt)])
