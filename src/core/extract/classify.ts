// Keyword/heading document classifier (FR-DOC-04 fallback, no LLM). Never claims handwriting.
import type { DocType } from '../types'

export interface Classification {
  docType: DocType
  /** 0..1 — margin of the winning class over the runner-up. */
  confidence: number
  handwrittenHint: false
  scores: Partial<Record<DocType, number>>
}

/** `heading`: terms that name the document only in a heading line ("RADIATION ONCOLOGY OPD"), not in a letterhead tagline. */
type Vocab = { title: string[]; body: string[]; heading?: string[] }

// Terms: case-insensitive whole words/phrases, except ALL-CAPS terms of ≤ 4 letters (case-sensitive, e.g. CT, ER, OD).
const VOCAB: Partial<Record<DocType, Vocab>> = {
  pathology_report: {
    title: ['histopathology report', 'histopathological examination', 'histopathology', 'surgical pathology', 'biopsy report', 'cytology report', 'HPE report', 'pathology report', 'frozen section', 'FNAC report', 'cytopathology'],
    body: ['gross examination', 'gross description', 'microscopic examination', 'microscopic description', 'microscopy', 'specimen', 'margins', 'tumour size', 'tumor size', 'lymph nodes', 'sections show', 'sections studied', 'blocks', 'slides', 'FNAC', 'nottingham'],
  },
  ihc_molecular_report: {
    title: ['immunohistochemistry', 'IHC report', 'molecular pathology', 'molecular diagnostics', 'NGS report', 'next generation sequencing', 'mutation analysis', 'FISH report', 'PD-L1', 'EGFR mutation', 'molecular report'],
    body: ['IHC', 'ER', 'PR', 'HER2', 'HER-2', 'Ki-67', 'Ki67', 'Allred', 'H-score', 'clone', 'positive control', 'mutation', 'exon', 'variant', 'NGS', 'EGFR', 'ALK', 'ROS1', 'KRAS', 'BRAF', 'TPS', 'amplification'],
  },
  imaging_report: {
    title: ['PET-CT', 'PET CT', 'CECT', 'NCCT', 'CT scan', 'MRI', 'magnetic resonance', 'ultrasonography', 'USG', 'ultrasound', 'X-ray', 'radiograph', 'mammography', 'mammogram', 'sonomammography', 'bone scan', 'department of radiology', 'radiology report', 'imaging report', 'radiodiagnosis'],
    body: ['impression', 'findings', 'contrast', 'axial', 'sagittal', 'coronal', 'lesion', 'SUV', 'SUVmax', 'enhancing', 'hypodense', 'hyperdense', 'radiologist', 'technique', 'opacity', 'BI-RADS', 'BIRADS', 'FDG'],
  },
  lab_report: {
    title: ['complete blood count', 'haemogram', 'hemogram', 'liver function test', 'kidney function test', 'renal function test', 'biochemistry', 'haematology', 'hematology', 'laboratory report', 'lab report', 'test report', 'investigation report', 'tumour markers', 'tumor markers', 'thyroid profile', 'lipid profile'],
    body: ['reference range', 'biological reference interval', 'reference interval', 'units', 'g/dL', 'mg/dL', 'haemoglobin', 'hemoglobin', 'platelet count', 'TLC', 'WBC', 'creatinine', 'bilirubin', 'SGOT', 'SGPT', 'sample collected', 'sample type', 'method'],
  },
  prescription_printed: {
    title: ['prescription', '℞', 'Rx', 'OPD prescription'],
    body: ['Tab', 'Cap', 'Inj', 'Syp', 'OD', 'BD', 'TDS', 'HS', 'SOS', 'after food', 'before food', 'after meals', '1-0-1', '1-0-0', '0-0-1', 'review after'],
  },
  discharge_summary: {
    title: ['discharge summary', 'discharge card', 'discharge certificate', 'summary of discharge'],
    body: ['date of admission', 'date of discharge', 'DOA', 'DOD', 'course in hospital', 'hospital course', 'condition at discharge', 'discharge advice', 'advice on discharge', 'IP No', 'IPD No', 'admitted', 'ward', 'bed no'],
  },
  consult_note: {
    title: ['OPD consultation', 'consultation note', 'outpatient', 'out patient', 'OP consultation', 'OPD card', 'OPD record', 'follow up note', 'follow-up note', 'clinic note', 'case sheet', 'progress note', 'OPD notes'],
    heading: ['OPD', 'consultation', 'first consultation'],
    body: ['chief complaints', 'c/o', 'history', 'examination', 'O/E', 'vitals', 'BP', 'pulse', 'follow up', 'review', 'plan'],
  },
  chemo_daycare_record: {
    title: ['day care', 'daycare', 'chemotherapy record', 'chemotherapy administration', 'chemo chart', 'infusion record', 'day care summary', 'chemotherapy day care'],
    body: ['cycle', 'regimen', 'premedication', 'infusion', 'chemotherapy', 'body surface area', 'BSA', 'ondansetron', 'dexamethasone', 'paclitaxel', 'carboplatin', 'cisplatin', 'docetaxel', 'cyclophosphamide', 'doxorubicin', 'trastuzumab', 'oxaliplatin', 'gemcitabine', '5-FU', 'capecitabine'],
  },
  radiotherapy_summary: {
    title: ['radiotherapy summary', 'RT summary', 'radiotherapy completion', 'external beam radiotherapy', 'radiotherapy treatment summary', 'radiation therapy summary'],
    heading: ['radiation oncology'],
    body: ['radiation oncology', 'Gy', 'fractions', 'IMRT', 'VMAT', '3DCRT', 'IGRT', 'linac', 'CTV', 'PTV', 'EBRT', 'brachytherapy', 'simulation', 'treatment started', 'treatment completed', 'radiotherapy'],
  },
  procedure_note: {
    title: ['operative note', 'operation note', 'operation notes', 'OT notes', 'OT note', 'procedure note', 'operative record', 'surgical notes', 'operation record', 'operative notes'],
    body: ['incision', 'anaesthesia', 'anesthesia', 'GA', 'surgeon', 'assistant', 'intraoperative', 'intra-operative', 'operative findings', 'closure', 'drain', 'blood loss', 'procedure', 'position', 'sutures'],
  },
  bill_insurance: {
    title: ['invoice', 'bill', 'receipt', 'tax invoice', 'final bill', 'cash memo', 'claim form', 'pre-authorization', 'pre-authorisation'],
    body: ['TPA', 'insurance', 'amount', 'total', 'GST', 'rupees', 'Rs', '₹', 'paid', 'payment', 'balance', 'qty', 'rate', 'discount', 'net payable', 'receipt no', 'invoice no'],
  },
}

const TITLE_WEIGHT = 6
const HEADING_BONUS = 3
const BODY_CAP = 10
const MIN_SCORE = 3
const TITLE_LINES = 15
const INSTITUTION_LINE = /(?<![\p{L}])(?:hospital|centre|center|institute|nursing\s+home)(?![\p{L}])/iu

function termRe(term: string): RegExp {
  const caseSensitive = /^[A-Z0-9℞]{1,4}$/.test(term)
  const body = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, caseSensitive ? 'u' : 'iu')
}

const COMPILED = Object.entries(VOCAB).map(([docType, v]) => ({
  docType: docType as DocType,
  title: v!.title.map(termRe),
  heading: (v!.heading ?? []).map(termRe),
  body: v!.body.map(termRe),
}))

function upperShare(line: string): number {
  const letters = line.match(/\p{L}/gu) ?? []
  return letters.length < 4 ? 0 : letters.filter((ch) => ch === ch.toUpperCase() && ch !== ch.toLowerCase()).length / letters.length
}

/** Classifies a document from its page texts (FR-DOC-04). Unknown/weak evidence → `other`. */
export function classifyDocument(pages: string[]): Classification {
  const all = pages.join('\n')
  const head = (pages[0] ?? '').split(/\r?\n/).slice(0, TITLE_LINES).join('\n')
  // Upper-case heading lines ("HISTOPATHOLOGY REPORT - PROSTATE NEEDLE BIOPSY") outrank a term in a sentence of the header
  // ("Clinical details: ... MRI prostate ...").
  // A letterhead line naming the institution ("YUKSOM ONCOLOGY & DAY-CARE CENTRE") is not the document's title.
  const headings = head.split('\n').filter((l) => !/[:：]/.test(l) && l.length <= 80 && !INSTITUTION_LINE.test(l) && (upperShare(l) >= 0.7 || /^\s*\S{1,12}\s*$/.test(l))) // or a one-word heading line ("Rx")
  // In a heading line that names two kinds, the last one is the document ("RADIATION ONCOLOGY OPD" is an OPD note,
  // "RADIATION ONCOLOGY - TREATMENT SUMMARY" a radiotherapy summary).
  const headed = new Set<DocType>()
  for (const line of headings) {
    let best: { docType: DocType; end: number } | null = null
    for (const c of COMPILED) {
      for (const re of [...c.title, ...c.heading]) {
        const m = re.exec(line)
        if (m && (!best || m.index + m[0].length > best.end)) best = { docType: c.docType, end: m.index + m[0].length }
      }
    }
    if (best) headed.add(best.docType)
  }
  const scores: Partial<Record<DocType, number>> = {}
  for (const c of COMPILED) {
    const title = headed.has(c.docType) ? TITLE_WEIGHT + HEADING_BONUS : c.title.some((re) => re.test(head)) ? TITLE_WEIGHT : 0
    const body = Math.min(BODY_CAP, c.body.filter((re) => re.test(all)).length)
    scores[c.docType] = title + body
  }
  const ranked = (Object.entries(scores) as [DocType, number][]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const [top, second] = ranked
  if (!top || top[1] < MIN_SCORE) return { docType: 'other', confidence: 0, handwrittenHint: false, scores }
  return { docType: top[0], confidence: Math.round(((top[1] - (second?.[1] ?? 0)) / top[1]) * 100) / 100, handwrittenHint: false, scores }
}
