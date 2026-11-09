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

/**
 * One document a package asks for. `accepts` empty = not a document OncoSetu holds (shown as a reminder, never as missing).
 * `panels`: blood tests the row names one by one; each must be named on a lab report in the file.
 */
export type PreauthRequirement = { asked: string; accepts: readonly DocType[]; stage: 'preauth' | 'claim'; note?: string; panels?: readonly LabPanel[] }

export type LabPanel = 'CBC' | 'LFT' | 'RFT'
// A lab report names a panel by its title, or by at least two of its tests ("Haemoglobin", "Platelet count").
const PANEL_NAME: Record<LabPanel, RegExp> = {
  CBC: /(?<![\p{L}])(?:CBC|complete\s+blood\s+count|full\s+blood\s+count|FBC|ha?emogram)(?![\p{L}])|संपूर्ण\s+रक्त\s+गणना/iu,
  LFT: /(?<![\p{L}])(?:LFT|liver\s+function(?:\s+tests?)?)(?![\p{L}])/iu,
  RFT: /(?<![\p{L}])(?:RFT|KFT|renal\s+function(?:\s+tests?)?|kidney\s+function(?:\s+tests?)?)(?![\p{L}])/iu,
}
const PANEL_TESTS: Record<LabPanel, RegExp[]> = {
  CBC: [/ha?emoglobin|(?<![\p{L}])Hb(?![\p{L}])/iu, /platelet/iu, /(?<![\p{L}])(?:WBC|TLC)(?![\p{L}])|leu[ck]ocyte/iu],
  LFT: [/bilirubin/iu, /(?<![\p{L}])(?:SGOT|AST)(?![\p{L}])/u, /(?<![\p{L}])(?:SGPT|ALT)(?![\p{L}])/u, /alkaline\s+phosphatase|(?<![\p{L}])ALP(?![\p{L}])/iu],
  RFT: [/creatinine/iu, /(?<![\p{L}])(?:urea|BUN)(?![\p{L}])/iu],
}

/** Panels a lab report names, from its title and the test names extracted from it. */
export function labPanels(names: readonly string[]): LabPanel[] {
  const text = names.join('\n')
  return (Object.keys(PANEL_NAME) as LabPanel[]).filter((p) => PANEL_NAME[p].test(text) || PANEL_TESTS[p].filter((re) => re.test(text)).length >= 2)
}

const PLAN_FORM: PreauthRequirement = {
  asked: 'Oncology Treatment Plan Approval form, filled and signed', accepts: [], stage: 'preauth',
  note: 'Prepared by the treating team at each pre-defined stage (NHA FAQ).',
}

export const PREAUTH_REQUIREMENTS: Record<PreauthLine, readonly PreauthRequirement[]> = {
  chemotherapy: [
    { asked: 'Biopsy report or surgical pathology report', accepts: ['pathology_report'], stage: 'preauth' },
    { asked: 'Blood tests: CBC, LFT, RFT', accepts: ['lab_report'], stage: 'preauth', panels: ['CBC', 'LFT', 'RFT'], note: 'Read from the names on the lab reports, not their values.' },
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

/** `labNames`: for a lab report, its test names as extracted (the title is always read too). */
export type FileDoc = { id: string; docType: DocType | null; documentDate: string | null; institution: string | null; title: string; labNames?: readonly string[] }
/** `partial`: some of the row's panels are on a lab report in the file, not all (`missingPanels`). */
export type PreauthRow = PreauthRequirement & { status: 'in_file' | 'partial' | 'not_in_file' | 'not_held'; docs: FileDoc[]; missingPanels?: LabPanel[] }

/** The requirement list for one treatment line, each with the documents in the file that are of an accepted type (newest first). */
export function preauthFile(line: PreauthLine, docs: readonly FileDoc[]): { rows: PreauthRow[]; inFile: number; checkable: number } {
  const rows = PREAUTH_REQUIREMENTS[line].map((r): PreauthRow => {
    if (!r.accepts.length) return { ...r, status: 'not_held', docs: [] }
    const found = docs.filter((d) => d.docType && r.accepts.includes(d.docType))
      .sort((a, b) => (b.documentDate ?? '').localeCompare(a.documentDate ?? ''))
    if (!found.length || !r.panels) return { ...r, status: found.length ? 'in_file' : 'not_in_file', docs: found }
    const named = new Set(found.flatMap((d) => labPanels([d.title, ...(d.labNames ?? [])])))
    const missingPanels = r.panels.filter((p) => !named.has(p))
    return { ...r, status: missingPanels.length ? 'partial' : 'in_file', docs: found, missingPanels }
  })
  const checkable = rows.filter((r) => r.status !== 'not_held')
  return { rows, inFile: checkable.filter((r) => r.status === 'in_file').length, checkable: checkable.length }
}

export type PreauthLineSummary = { line: PreauthLine; inFile: number; checkable: number; missing: string[] }

/** Pre-authorisation stage of one line, for the cross-patient worklist: in the file, and what is not (a partly complete row counts as not in). */
export function preauthSummary(line: PreauthLine, docs: readonly FileDoc[]): PreauthLineSummary {
  const rows = preauthFile(line, docs).rows.filter((r) => r.stage === 'preauth' && r.status !== 'not_held')
  return { line, inFile: rows.filter((r) => r.status === 'in_file').length, checkable: rows.length, missing: rows.filter((r) => r.status !== 'in_file').map((r) => r.asked) }
}
