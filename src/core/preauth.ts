// Pre-authorisation file check for PM-JAY oncology packages: which of the documents a package asks for are in the file.
// Document completeness only: OncoSetu does not judge eligibility, choose a package or read the content against the rules.
//
// Source: National Health Authority, "Standard Treatment Guidelines (Guidance documents for processing Oncology packages
// under PM-JAY)", prepared with Tata Memorial Hospital and the National Cancer Grid (breast examples: medical oncology
// MO001A/B slide 9, surgical oncology SC059A slide 10, radiation oncology MR004B slide 11), hosted by the Uttarakhand SHA:
// https://sha.uk.gov.in/ScannedDocs/WebSite/Uploads/STAND_TREAT/Presentation_on_Oncology_STGs.pdf (undated, about 2020–21).
// Treatment plan approval form: NHA FAQ https://supportbeta.nha.gov.in/kb/faq.php?id=57.
import type { DocType } from './types'

export type PreauthLine = 'chemotherapy' | 'surgery' | 'radiotherapy'
export const PREAUTH_LINES: readonly { key: PreauthLine; label: string; example: string }[] = [
  { key: 'chemotherapy', label: 'Chemotherapy', example: 'medical oncology, breast example (MO001A/B)' },
  { key: 'surgery', label: 'Surgery', example: 'surgical oncology, breast-conserving surgery example (SC059A)' },
  { key: 'radiotherapy', label: 'Radiotherapy', example: 'radiation oncology, 3D-CRT example (MR004B)' },
]

/** One document a package asks for. `accepts` empty = not a document OncoSetu holds (shown as a reminder, never as missing). */
export type PreauthRequirement = { asked: string; accepts: readonly DocType[]; stage: 'preauth' | 'claim'; note?: string }

const PLAN_FORM: PreauthRequirement = {
  asked: 'Oncology Treatment Plan Approval form, filled and signed', accepts: [], stage: 'preauth',
  note: 'Prepared by the treating team at each pre-defined stage (NHA FAQ).',
}

export const PREAUTH_REQUIREMENTS: Record<PreauthLine, readonly PreauthRequirement[]> = {
  chemotherapy: [
    { asked: 'Biopsy report or surgical pathology report', accepts: ['pathology_report'], stage: 'preauth' },
    { asked: 'Blood tests: CBC, LFT, RFT', accepts: ['lab_report'], stage: 'preauth', note: 'Check that all three are there.' },
    { asked: 'Imaging: USG abdomen and pelvis, chest X-ray, or CECT chest, abdomen and pelvis; or bone scan', accepts: ['imaging_report'], stage: 'preauth' },
    { asked: 'ECG and 2D-ECHO', accepts: [], stage: 'preauth', note: 'Asked for some regimens; done at the treating hospital.' },
    PLAN_FORM,
    { asked: 'Reports of the tests (pathology, radiology, haematology, biochemistry)', accepts: ['pathology_report', 'imaging_report', 'lab_report'], stage: 'claim' },
    { asked: 'Discharge summary (inpatient or day care)', accepts: ['discharge_summary', 'chemo_daycare_record'], stage: 'claim' },
    { asked: 'Charts of the chemotherapy regimen', accepts: ['chemo_daycare_record'], stage: 'claim' },
    { asked: 'Bar codes of the drugs', accepts: [], stage: 'claim', note: 'Kept by the pharmacy.' },
  ],
  surgery: [
    { asked: 'Clinical notes', accepts: ['consult_note'], stage: 'preauth' },
    { asked: 'Imaging named for the package (mammography in the breast example; CT or MRI optional)', accepts: ['imaging_report'], stage: 'preauth' },
    { asked: 'FNAC or biopsy report', accepts: ['pathology_report'], stage: 'preauth' },
    PLAN_FORM,
    { asked: 'Detailed procedure or operative notes', accepts: ['procedure_note'], stage: 'claim' },
    { asked: 'Histopathology (HPE) report', accepts: ['pathology_report'], stage: 'claim' },
    { asked: 'Detailed discharge summary', accepts: ['discharge_summary'], stage: 'claim' },
  ],
  radiotherapy: [
    { asked: 'HPE report', accepts: ['pathology_report'], stage: 'preauth' },
    { asked: 'Clinical notes with the planned line of treatment', accepts: ['consult_note'], stage: 'preauth' },
    PLAN_FORM,
    { asked: 'Detailed discharge summary, with the radiotherapy given', accepts: ['radiotherapy_summary', 'discharge_summary'], stage: 'claim' },
  ],
}

export type FileDoc = { id: string; docType: DocType | null; documentDate: string | null; institution: string | null; title: string }
export type PreauthRow = PreauthRequirement & { status: 'in_file' | 'not_in_file' | 'not_held'; docs: FileDoc[] }

/** The requirement list for one treatment line, each with the documents in the file that are of an accepted type (newest first). */
export function preauthFile(line: PreauthLine, docs: readonly FileDoc[]): { rows: PreauthRow[]; inFile: number; checkable: number } {
  const rows = PREAUTH_REQUIREMENTS[line].map((r): PreauthRow => {
    if (!r.accepts.length) return { ...r, status: 'not_held', docs: [] }
    const found = docs.filter((d) => d.docType && r.accepts.includes(d.docType))
      .sort((a, b) => (b.documentDate ?? '').localeCompare(a.documentDate ?? ''))
    return { ...r, status: found.length ? 'in_file' : 'not_in_file', docs: found }
  })
  const checkable = rows.filter((r) => r.status !== 'not_held')
  return { rows, inFile: checkable.filter((r) => r.status === 'in_file').length, checkable: checkable.length }
}
