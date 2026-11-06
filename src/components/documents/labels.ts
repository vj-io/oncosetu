// Staff-facing labels for the documents screens (English staff UI; patient strings live in src/i18n/documents.ts).
import type { Status } from '@/components/ui'

export const STAGE_KEYS = ['received', 'text', 'classified', 'identity', 'extracted', 'gate', 'completeness'] as const
export const STAGE_LABELS = ['Received', 'Text', 'Classified', 'Identity', 'Extracted', 'Evidence gate', 'Completeness'] as const

export type StageState = 'done' | 'active' | 'pending' | 'failed' | 'waiting'

/** Index into STAGE_KEYS for the StageTracker: first non-done stage; all done → length. */
export function trackerPosition(stages: { key: string; state: StageState }[]): { current: number; failed: boolean; waiting: boolean } {
  const i = stages.findIndex((s) => s.state !== 'done')
  if (i === -1) return { current: stages.length, failed: false, waiting: false }
  return { current: i, failed: stages[i].state === 'failed', waiting: stages[i].state === 'waiting' }
}

export const EVENT_LABEL: Record<string, string> = {
  document_received: 'Document received',
  procedure_documented: 'Procedure documented',
  pathology_report_documented: 'Pathology report documented',
  molecular_test_documented: 'IHC / molecular test documented',
  imaging_report_documented: 'Imaging report documented',
  lab_report_documented: 'Lab report documented',
  prescription_documented: 'Prescription documented',
  chemotherapy_session_documented: 'Chemotherapy session documented',
  radiotherapy_documented: 'Radiotherapy documented',
  admission_documented: 'Admission documented',
  discharge_documented: 'Discharge documented',
  consultation_documented: 'Consultation documented',
  referral_documented: 'Referral documented',
  report_pending_documented: 'Report documented as pending',
  allergy_documented: 'Allergy statement documented',
  follow_up_documented: 'Follow-up date documented',
  lab_results_documented: 'Lab results as written',
  diagnosis_documented: 'Diagnosis as written',
  history_documented: 'History as written',
  patient_statement: 'Patient statement',
}

export const FIELD_LABEL: Record<string, string> = {
  procedure_text: 'Procedure', institution_name: 'Institution', event_date_text: 'Date as written', test_name: 'Test', test_names: 'Tests',
  specimen_text: 'Specimen', accession_number: 'Accession', status_text: 'Status', medication_names: 'Medicines', prescriber_name: 'Prescriber',
  cycle_number: 'Cycle', regimen_text: 'Regimen', treatment_text: 'Treatment', doctor_name: 'Doctor', department_text: 'Department',
  referred_to_text: 'Referred to', document_title: 'Title', statement_text: 'Statement', scan_name: 'Scan',
  allergy_text: 'Allergy (as written)', appointment_text: 'Due', section_text: 'As written', history_text: 'As written',
}

/** Event flag → chip label (never colour alone). */
export const FLAG_LABEL: Record<string, string> = {
  low_confidence: 'Low OCR confidence', binding_uncertain: 'Binding uncertain', date_ambiguous: 'Date ambiguous (DD/MM read)',
  date_unknown: 'Date not stated', date_future: 'Date in the future', late_received: 'Newly received older record',
  identity_warning: 'Attached by a person', date_from_document: 'Date = document date', conflict: 'Conflict', patient_confirmed: 'Patient confirmed',
}

export const PRIORITY_GROUPS: { title: string; types: string[] }[] = [
  { title: 'Pathology & molecular', types: ['pathology_report', 'ihc_molecular_report'] },
  { title: 'Imaging reports', types: ['imaging_report'] },
  { title: 'Discharge & procedure summaries', types: ['discharge_summary', 'procedure_note'] },
  { title: 'Treatment records', types: ['chemo_daycare_record', 'radiotherapy_summary', 'consult_note'] },
  { title: 'Prescriptions', types: ['prescription_printed', 'prescription_handwritten'] },
  { title: 'Lab reports', types: ['lab_report'] },
  { title: 'Other & unclassified', types: ['bill_insurance', 'other'] },
]

export const DOC_TYPE_OPTIONS: [string, string][] = [
  ['pathology_report', 'Histopathology report'], ['ihc_molecular_report', 'IHC / molecular report'], ['imaging_report', 'Imaging report'],
  ['lab_report', 'Lab report'], ['prescription_printed', 'Prescription (printed)'], ['prescription_handwritten', 'Prescription (handwritten)'],
  ['discharge_summary', 'Discharge summary'], ['consult_note', 'Consultation note'], ['chemo_daycare_record', 'Chemotherapy day-care record'],
  ['radiotherapy_summary', 'Radiotherapy summary'], ['procedure_note', 'Procedure / operative note'], ['bill_insurance', 'Bill / insurance document'],
  ['other', 'Other document'],
]

export function statusBadge(status: string): { status: Status; label?: string } {
  switch (status) {
    case 'queued': case 'processing': case 'done': case 'needs_review': case 'failed': return { status }
    case 'quarantined': return { status: 'failed', label: 'Quarantined' }
    case 'unreadable': return { status: 'failed', label: 'Unreadable' }
    case 'needs_password': return { status: 'needs_review', label: 'Password needed' }
    default: return { status: 'queued', label: status }
  }
}

export const shortId = (id: string) => id.replace(/-/g, '').slice(-6).toUpperCase()

const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const DATETIME = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
export const fmtDate = (iso: string | null | undefined) => (iso ? DATE.format(new Date(iso + 'T00:00:00Z')) : 'date not stated')
export const fmtDateTime = (iso: string) => DATETIME.format(new Date(iso))

const REASON_TEXT: Record<string, string> = {
  name_mismatch: 'name on the report differs', sex_mismatch: 'sex differs', age_mismatch: 'age differs by more than a year',
  dob_mismatch: 'date of birth differs', initial_conflict: 'initials conflict', name_missing: 'no patient name found on the report',
  name_initials_only: 'only initials on the report', single_name_token: 'only one name on the report', baby_of_clause: '"Baby of" report',
  no_corroborating_field: 'name matches but no age, date of birth or ID to confirm it', handwritten_header: 'handwritten header — not machine-read',
}
export const identityReasonText = (r: string) => REASON_TEXT[r] ?? r.replace(/_/g, ' ')
