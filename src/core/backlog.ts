// FR-ONB-01 backlog order: pathology/molecular → imaging → discharge/procedure → treatment → prescriptions → labs → other.
// Used for the documents screen (by classified type) and, before anything is read, for the order a batch is uploaded and
// processed in (by a guess from the file name). Client-safe.
import type { DocType } from './types'

export const ONBOARDING_PRIORITY: DocType[] = [
  'pathology_report', 'ihc_molecular_report', 'imaging_report', 'discharge_summary', 'procedure_note', 'chemo_daycare_record',
  'radiotherapy_summary', 'consult_note', 'prescription_printed', 'prescription_handwritten', 'lab_report', 'bill_insurance', 'other',
]

/** Position in the backlog order; an unknown type sorts with `other`. */
export function backlogRank(t: string | null): number {
  const i = ONBOARDING_PRIORITY.indexOf((t ?? 'other') as DocType)
  return i < 0 ? ONBOARDING_PRIORITY.indexOf('other') : i
}

// Checked in backlog order, so the first match is the most urgent reading ("histopathology addendum" is pathology).
// ponytail: English file-name keywords only; a phone photo (IMG_1234.jpg) has no hint and waits with `other`.
const HINTS: [RegExp, DocType][] = [
  [/histo|patholog|biops|\bhpe\b|fnac|cytolog/i, 'pathology_report'],
  [/\bihc\b|immuno|molecular|her-?2|egfr|kras|brca|pd-?l1|\bngs\b/i, 'ihc_molecular_report'],
  [/\bct\b|\bmri\b|\bpet\b|x-?ray|ultrasound|\busg\b|mammo|sonograph|radiolog|imaging|\.dcm$/i, 'imaging_report'],
  [/discharge/i, 'discharge_summary'],
  [/procedure|operati|surgery|\bot[-_ ]?note/i, 'procedure_note'],
  [/chemo|daycare|day-care/i, 'chemo_daycare_record'],
  [/radiother|\brt[-_ ]?summary/i, 'radiotherapy_summary'],
  [/consult|\bopd\b/i, 'consult_note'],
  [/prescri|\brx\b/i, 'prescription_printed'],
  [/\blab\b|\bcbc\b|\blft\b|\bkft\b|\brft\b|blood|haemo|hemo/i, 'lab_report'],
  [/\bbill|invoice|insur/i, 'bill_insurance'],
]

/** A cheap guess of a document's type from its file name alone (nothing is read). null = no hint. */
export function typeHint(fileName: string): DocType | null {
  return HINTS.find(([re]) => re.test(fileName))?.[1] ?? null
}

/** Backlog order by file-name hint; stable, so files with the same rank keep the order they came in. */
export function inBacklogOrder<T>(items: readonly T[], fileName: (t: T) => string): T[] {
  return [...items].sort((a, b) => backlogRank(typeHint(fileName(a))) - backlogRank(typeHint(fileName(b))))
}
