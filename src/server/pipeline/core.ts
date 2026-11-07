// Pure pipeline core (PRD §9.1 stages 3–9): pages → classification → header/identity → candidates → evidence gate
// → dated draft events. No DB and no request context, so scripts/eval.ts runs exactly this code offline.
import {
  classifyDocument, detectInjection, extractPatterns, parseHeader, type Extraction, type LabelledSpan, type ParsedHeader, type Span,
} from '@/core/extract'
import { daysBetween, findDates, parseDate, usesDayFirst, type ParsedDate } from '@/core/dates'
import { runGate, type Candidate, type GateEvidence, type GatePage, type GateResult } from '@/core/gate'
import { decideIdentity, type IdentityDecision, type PatientIdentity } from '@/core/identity'
import type { DocType, EventFlag, EventType, ExtractionMethod } from '@/core/types'
import { detectLanguage, type PageRead } from './text'

// E-DOC-15: a document dated more than a year before it reached OncoSetu ("years ago, received now").
export const LATE_RECEIVED_DAYS = 365

/** What an LLM call returns to the core (see src/server/ai/extract.ts). null → rule-based path. */
export type LlmExtractor = (pages: { pageNo: number; text: string }[], docType: DocType) => Promise<Extraction | null>

// ---------- classification ----------

export type Classified = {
  docType: DocType
  docTypeConfidence: number
  /** Per-page classes for mixed documents (E-DOC-10); empty when the document is one class. */
  pageTypes: { pageNo: number; docType: DocType }[]
  handwritten: boolean
  language: ReturnType<typeof detectLanguage>['language']
  languageUnsupported: boolean
  /** Pages the extractor may read: text present, not handwritten. */
  usable: PageRead[]
}

// ponytail: Hindi lab vocabulary the core classifier lacks; move into core/extract/classify VOCAB when it gains Hindi.
const HI_LAB = ['हीमोग्लोबिन', 'रक्त', 'प्लेटलेट', 'सामान्य सीमा', 'जाँच परिणाम', 'जांच परिणाम', 'श्वेत', 'बिलीरुबिन', 'क्रिएटिनिन']

/** Stage 3–4: handwriting, language, document class (rule-based; an LLM class can override later). */
export function classify(pages: PageRead[], override?: DocType | null): Classified {
  const withText = pages.filter((p) => p.text.trim())
  const usable = withText.filter((p) => !p.handwriting?.handwritten)
  const handwritten = withText.length > 0 && usable.length === 0
  const all = withText.map((p) => p.text).join('\n')
  const lang = detectLanguage(all)
  const base = classifyDocument((usable.length ? usable : withText).map((p) => p.text))
  let docType = override ?? base.docType
  let confidence = override ? 1 : base.confidence
  // FR-DOC-04 has no admission class: an admission summary is `other`, whatever its letterhead tagline says.
  const top = (withText[0]?.text ?? '').split('\n').slice(0, 15).join('\n')
  if (!override && docType !== 'discharge_summary' && /(?<![\p{L}])admission\s+(?:summary|record|note)(?![\p{L}])/iu.test(top)) {
    docType = 'other'
    confidence = 0.5
  }
  if (!override && docType === 'other' && HI_LAB.filter((w) => all.includes(w)).length >= 3) {
    docType = 'lab_report'
    confidence = 0.5
  }
  if (!override && handwritten && /(?<![\p{L}])(?:Rx|Tab\.?|Cap\.?|Inj\.?|Syp\.?)(?![\p{L}])|℞/u.test(all)) docType = 'prescription_handwritten'
  // A page starts a different document only when it scores strongly for another class and not at all for this one.
  const pageTypes: Classified['pageTypes'] = []
  if (!override && usable.length > 1) {
    for (const p of usable) {
      const c = classifyDocument([p.text])
      if (c.docType !== docType && c.docType !== 'other' && (c.scores[c.docType] ?? 0) >= 9 && (c.scores[docType] ?? 0) <= 3) {
        pageTypes.push({ pageNo: p.pageNo, docType: c.docType })
      }
    }
  }
  return { docType, docTypeConfidence: confidence, pageTypes, handwritten, language: lang.language, languageUnsupported: lang.unsupported, usable }
}

// ---------- header ----------

export type HeaderField = { value: string; start: number; end: number }
export type HeaderOut = {
  pageNo: number | null
  name?: HeaderField; age?: HeaderField; sex?: HeaderField; dob?: HeaderField; mrn?: HeaderField & { label: string }
  reportDate?: HeaderField & { label: string }; institution?: HeaderField; accession?: HeaderField
  /** The doctor the document names as in charge (name only); shown to the patient as "named on your latest papers". */
  doctor?: HeaderField & { label: string }
}

const span = (s?: Span): HeaderField | undefined => (s ? { value: s.value, start: s.start, end: s.end } : undefined)

// Document-date labels in priority order (FR-EXT-04 `document_date` = the report's own date). A colon is required so
// references such as "(reported 18/03/2026)" to another report never win.
const DOC_DATE_LABELS: [string, RegExp][] = [
  ['report date', /(?<![\p{L}])(?:Report(?:ed)?\s*(?:Date|On|Dt\.?)|Date\s+(?:of\s+)?Report(?:ed|ing)?|Reporting\s+Date|Reported\s+on)\s*[:：]/giu],
  ['addendum date', /(?<![\p{L}])Addendum\s+Date\s*[:：]/giu],
  ['discharge date', /(?<![\p{L}])(?:Date\s+of\s+Discharge|Discharge\s+Date)\s*[:：]/giu],
  ['visit date', /(?<![\p{L}])(?:Date\s+of\s+(?:Visit|Study|Scan|Consultation|Procedure|Examination)|Visit\s+Date|Scan\s+Date)\s*[:：]/giu],
  ['collection date', /(?<![\p{L}])(?:(?:Sample\s+)?Collect(?:ed|ion)\s*(?:Date|On)?|Date\s+(?:of\s+)?Collect(?:ed|ion))\s*[:：]/giu],
  ['date', /(?<![\p{L}])(?:Date|Dated|Dt\.?|दिनांक|तारीख़?)\s*[:：]/giu],
  ['admission date', /(?<![\p{L}])(?:Date\s+of\s+Admission|Admission\s+Date)\s*[:：]/giu],
]

function pickDocumentDate(text: string): LabelledSpan | undefined {
  for (const [label, re] of DOC_DATE_LABELS) {
    for (const m of text.matchAll(re)) {
      const after = m.index! + m[0].length
      const window = text.slice(after, after + 40)
      const d = findDates(window).find((s) => s.kind === 'absolute' && /^[\s\-–=.]*$/.test(window.slice(0, s.start)))
      if (d) return { value: d.raw, start: after + d.start, end: after + d.end, label, labelStart: m.index! }
    }
  }
  return undefined
}

const INST_WORD = /(?:hospital|institute|centre|center|clinic|diagnostic|laborator|lab\b|medical|healthcare|pathology|imaging|cancer|oncology|memorial|trust|college|nursing\s+home|unit\b|day-?care|लेबोरेटरी|प्रयोगशाला|अस्पताल|संस्थान|चिकित्सालय|केंद्र|क्लिनिक)/iu

/** Letterhead name: the first of the top lines that reads as an institution (verbatim substring of the page). */
function pickInstitution(text: string): Span | undefined {
  let offset = 0
  for (const line of text.split('\n').slice(0, 6)) {
    const lineStart = offset
    offset += line.length + 1
    const lead = line.search(/[\p{L}]/u)
    if (lead < 0) continue
    let s = line.slice(lead).replace(/^[\p{Lu}]\)?\s+(?=[\p{L}])/u, '') // OCR junk such as "C " before the name
    const cut = s.search(/[,|\t]/)
    if (cut > 0) s = s.slice(0, cut)
    s = s.trim()
    if (/^(?:dr\.?\s|tel|email|e-mail|reg|phone|fax|www)/i.test(s) || /[:：]/.test(s)) continue
    if ((s.match(/\p{L}/gu) ?? []).length < 6) continue
    const caps = /^[\p{Lu}0-9 &.'’()-]+$/u.test(s) && s.split(/\s+/).length >= 2
    if (INST_WORD.test(s) || caps) {
      const start = lineStart + line.indexOf(s)
      return { value: s, start, end: start + s.length }
    }
  }
  return undefined
}

// ponytail: "Patient:" label the core header parser does not know yet; fold into core/extract/header NAME_LABEL.
const PATIENT_LABEL = /(?<![\p{L}])(?:Patient|Pt\.?)\s*[:：][ \t]*([\p{L}][\p{L}\p{M}.'’ ]*?)[ ]*(?=\t|\s{2,}|\n|$)/u

/** Core header + the pipeline's document-date and letterhead pickers (offsets into the page). */
export function headerFor(text: string): ParsedHeader {
  const parsed = parseHeader(text)
  if (!parsed.name) {
    const m = PATIENT_LABEL.exec(text)
    if (m && m[1].replace(/[^\p{L}]/gu, '').length >= 2) {
      const start = m.index + m[0].indexOf(m[1])
      parsed.name = { value: m[1], start, end: start + m[1].length, label: 'Patient', labelStart: m.index }
    }
  }
  parsed.reportDate = pickDocumentDate(text) ?? parsed.reportDate
  parsed.institution = pickInstitution(text) ?? (parsed.institution && INST_WORD.test(parsed.institution.value) ? parsed.institution : undefined)
  return parsed
}

export type Identified = {
  header: HeaderOut
  identity: IdentityDecision
  documentDate: ParsedDate | null
  institution: string | null
  accession: string | null
  isAddendum: boolean
}

const ADDENDUM = /(?<![\p{L}])(?:addendum|amended\s+report|corrigendum|supplementary\s+report|revised\s+report)(?![\p{L}])/iu

/** Header fields from the first readable page. */
export function readHeader(pages: PageRead[]): { header: HeaderOut; parsed: ParsedHeader | null } {
  const first = [...pages].sort((a, b) => a.pageNo - b.pageNo).find((p) => p.text.trim())
  if (!first) return { header: { pageNo: null }, parsed: null }
  const parsed = headerFor(first.text)
  return {
    parsed,
    header: {
      pageNo: first.pageNo, name: span(parsed.name), age: span(parsed.age), sex: span(parsed.sex), dob: span(parsed.dob),
      mrn: parsed.mrn ? { ...span(parsed.mrn)!, label: parsed.mrn.label } : undefined,
      reportDate: parsed.reportDate ? { ...span(parsed.reportDate)!, label: parsed.reportDate.label } : undefined,
      institution: span(parsed.institution),
      accession: span(parsed.ids.find((i) => i.label === 'Sample ID')),
      doctor: parsed.doctor ? { ...span(parsed.doctor)!, label: parsed.doctor.label } : undefined,
    },
  }
}

/**
 * Stage 5 + 9: header identity decision (FR-ID-03/04), from the regex header only — it runs before any LLM call so
 * a wrong-patient document never reaches a model under this patient's consent. Handwritten headers are never read.
 */
export function identify(pages: PageRead[], c: Classified, patient: PatientIdentity, receivedAt: Date): Identified {
  const { header } = readHeader(c.handwritten ? [] : c.usable.length ? c.usable : pages)
  const documentDate = header.reportDate ? parseDate(header.reportDate.value, { now: receivedAt }) : null
  const first = pages.find((p) => p.pageNo === header.pageNo)
  const top = first ? first.text.split('\n').slice(0, 15).join('\n') : ''
  const identity: IdentityDecision = c.handwritten
    ? { result: 'insufficient', score: 0, reasons: ['handwritten_header'], notes: [] }
    : decideIdentity(
      patient,
      { name: header.name?.value, age: header.age?.value, dob: header.dob?.value, sex: header.sex?.value, mrn: header.mrn?.value },
      documentDate?.precision === 'day' ? documentDate.iso : null,
    )
  return {
    header, identity, documentDate, institution: header.institution?.value ?? null, accession: header.accession?.value ?? null,
    isAddendum: ADDENDUM.test(top),
  }
}

// ---------- candidates ----------

// Chemo "cycle" mentions that are not a session given: future plans, due dates, intervals (core patterns over-match).
// ponytail: candidate hygiene that belongs in core/extract/patterns; kept here until the extractor learns it.
const NOT_A_SESSION = /\bnext\s+(?:visit|cycle)\b|\bdue\s+on\b|\bdeferred\b|\bscheduled\b|\binterval\b|\bfrom\s+last\s+cycle\b|\bwill\s+(?:be|receive)\b/i
const MED_ROW = /^[ \t]*(?:\d{1,2}[.)]?[ \t]+)?(?:Tab|Tablet|Cap|Capsule|Inj|Injection|Syp|Syrup|Susp)\.?[ \t]+([A-Za-z][A-Za-z-]*)/

/** Printed medication rows ("1  Tab. Ondansetron 4 mg …", discharge-medication tables) grouped into ≤ 300-char blocks. */
function prescriptionRows(page: { pageNo: number; text: string }): Candidate[] {
  const out: Candidate[] = []
  let block: { start: number; end: number; names: string[] } | null = null
  const flush = () => {
    if (block) out.push({ event_type: 'prescription_documented', fields: { medication_names: [...new Set(block.names)] }, quote: page.text.slice(block.start, block.end).trim(), page_no: page.pageNo })
    block = null
  }
  let offset = 0
  for (const line of page.text.split('\n')) {
    const start = offset
    offset += line.length + 1
    const m = MED_ROW.exec(line)
    if (!m) continue
    const end = start + line.length
    if (block && end - block.start > 300) flush()
    if (block) { block.end = end; block.names.push(m[1]) } else block = { start, end, names: [m[1]] }
  }
  flush()
  return out
}

function rulesCandidates(pages: PageRead[], docType: DocType): Candidate[] {
  const ps = [...pages].sort((a, b) => a.pageNo - b.pageNo).map((p) => ({ pageNo: p.pageNo, text: p.text }))
  let out = extractPatterns(ps, docType, headerFor(ps[0].text))
  if ((docType === 'prescription_printed' || docType === 'discharge_summary') && !out.some((c) => c.event_type === 'prescription_documented')) {
    out = out.concat(ps.flatMap(prescriptionRows))
  }
  return out.filter((c) => !(c.event_type === 'chemotherapy_session_documented' && NOT_A_SESSION.test(c.quote)))
}

/** Stage 6: candidate events. LLM if given (falls back on null), else the deterministic pattern extractor. */
export type ExtractionMethodUsed = 'llm' | 'rules' | 'hybrid'

/**
 * Stage 6. With `augmentRules` (the free-tier model, whose recall is lower than the rule library's), the LLM's
 * candidates are added to the rule-based ones instead of replacing them: both go through the same evidence gate and
 * drafts are de-duplicated after it, so the LLM can add facts the rules miss but can never remove one they find.
 */
export async function extractCandidates(c: Classified, llm?: LlmExtractor | null, opts: { augmentRules?: boolean } = {}): Promise<{ candidates: Candidate[]; method: ExtractionMethodUsed; llmDocType: DocType | null }> {
  if (c.handwritten || c.languageUnsupported || !c.usable.length) return { candidates: [], method: 'rules', llmDocType: null }
  const rules = () => {
    // Mixed documents: extract each page group with its own class.
    const groups = new Map<DocType, PageRead[]>()
    for (const p of c.usable) {
      const t = c.pageTypes.find((x) => x.pageNo === p.pageNo)?.docType ?? c.docType
      groups.set(t, [...(groups.get(t) ?? []), p])
    }
    return [...groups].flatMap(([t, ps]) => rulesCandidates(ps, t)).map((x): Candidate => ({ ...x, origin: 'rules' }))
  }
  if (llm) {
    const out = await llm(c.usable.map((p) => ({ pageNo: p.pageNo, text: p.text })), c.docType)
    if (out) {
      const fromLlm = out.items.map((x): Candidate => ({ ...x, origin: 'llm' }))
      return opts.augmentRules
        ? { candidates: [...fromLlm, ...rules()], method: 'hybrid', llmDocType: out.doc_type }
        : { candidates: fromLlm, method: 'llm', llmDocType: out.doc_type }
    }
  }
  return { candidates: rules(), method: 'rules', llmDocType: null }
}

// ---------- gate + dates ----------

export type DraftFlag = EventFlag | 'ocr' | 'rule_based' | 'llm' | 'date_from_document'

export type DraftEvent = {
  eventType: EventType
  fields: Record<string, unknown>
  eventDate: string | null
  datePrecision: ParsedDate['precision']
  dateFlags: string[]
  documentDate: string | null
  extractionMethod: ExtractionMethod
  flags: Partial<Record<DraftFlag, boolean>>
  evidence: GateEvidence
}

/** Event types whose date IS the document's date when the quote itself carries none (report-level facts). */
const DOC_DATED: ReadonlySet<string> = new Set([
  'pathology_report_documented', 'molecular_test_documented', 'imaging_report_documented', 'lab_report_documented',
  'prescription_documented', 'consultation_documented', 'report_pending_documented', 'referral_documented',
  'chemotherapy_session_documented', 'allergy_documented', 'lab_results_documented', 'diagnosis_documented',
  'history_documented', 'stage_documented', 'marker_results_documented', 'margins_documented', 'impression_documented',
  'addendum_documented', 'regimen_documented',
])

/** One fact per document: the same type + key (cycle, date, test, procedure) found twice keeps the dated, earliest quote. */
function dedupeKey(d: DraftEvent): string {
  const f = d.fields
  const s = (k: string) => String(f[k] ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  switch (d.eventType) {
    case 'chemotherapy_session_documented': return `chemo|${s('cycle_number')}`
    case 'admission_documented': case 'discharge_documented': return `${d.eventType}|${d.eventDate}`
    case 'procedure_documented': return `proc|${s('procedure_text')}|${d.eventDate}`
    case 'prescription_documented': case 'lab_results_documented': return `${d.eventType}|${d.evidence.charStart}`
    case 'follow_up_documented': return `fu|${s('appointment_text')}|${d.eventDate}`
    case 'diagnosis_documented': case 'history_documented': return `${d.eventType}|${s('section_text')}${s('history_text')}`
    // Quote-only oncology lines: one fact per distinct line of the document.
    case 'stage_documented': case 'marker_results_documented': case 'margins_documented': case 'impression_documented':
    case 'addendum_documented': case 'regimen_documented':
      return `${d.eventType}|${d.evidence.pageNo}|${d.evidence.charStart}`
    default: return `${d.eventType}|${s('test_name')}|${d.eventDate}`
  }
}

/** Stage 7–8: the evidence gate, then dates (FR-EXT-03/04, E-DOC-11..15). Only accepted items become drafts. */
export function gateAndDate(
  candidates: Candidate[], c: Classified, ident: Pick<Identified, 'documentDate'>, receivedAt: Date, method: ExtractionMethodUsed,
): { gate: GateResult; drafts: DraftEvent[] } {
  const gatePages: GatePage[] = c.usable.map((p) => ({ pageNo: p.pageNo, text: p.text, ...(p.words ? { words: p.words } : {}) }))
  const gate = runGate(candidates, gatePages)
  const received = receivedAt.toISOString().slice(0, 10)
  const doc = ident.documentDate && ident.documentDate.precision !== 'unknown' ? ident.documentDate : null
  // Indian records are day first. One date such as 22/01/2026 in the document settles every other numeric date in it.
  const dayFirst = c.usable.some((p) => usesDayFirst(p.text))
  const all = gate.accepted.map(({ candidate, evidence, flags }): DraftEvent => {
    const page = c.usable.find((p) => p.pageNo === evidence.pageNo)!
    const fields = { ...candidate.fields }
    // The stored date is always re-derived from raw text in the quote (an ISO event_date passed the gate only
    // because a raw date in the quote parses to it).
    const raw = typeof fields.event_date_text === 'string' ? fields.event_date_text : null
    const ruleBased = method === 'rules' || candidate.origin === 'rules'
    // A model often leaves the date field empty although the quote carries one ("Next visit: 02/06/2026 ..."). When the
    // quote holds exactly one date, that date is the item's own date; several dates stay undecided (the document date applies).
    const quoteDates = findDates(evidence.quote).filter((d) => d.kind === 'absolute')
    const rawInQuote = raw ?? (fields.event_date ? quoteDates[0]?.raw ?? null : !ruleBased && quoteDates.length === 1 ? quoteDates[0].raw : null)
    delete fields.event_date
    const parsed = rawInQuote ? parseDate(rawInQuote, { now: receivedAt, anchor: doc?.iso ?? null, dayFirst }) : null
    // Read the other way (month first) the date would lie after the day this reached us: the day-first reading is the only possible one.
    if (parsed?.flags.includes('date_ambiguous') && parsed.iso && parsed.iso <= received && candidate.event_type !== 'follow_up_documented' && (parsed.alternatives ?? []).every((a) => a > received)) {
      parsed.flags = parsed.flags.filter((f) => f !== 'date_ambiguous')
    }
    const out: DraftEvent['flags'] = {}
    for (const f of flags) out[f] = true
    let eventDate = parsed?.iso ?? null
    let precision: ParsedDate['precision'] = parsed?.precision ?? 'unknown'
    let dateFlags = parsed ? [...parsed.flags] : []
    if (!parsed && doc && DOC_DATED.has(candidate.event_type)) {
      eventDate = doc.iso
      precision = doc.precision
      dateFlags = [...doc.flags]
      out.date_from_document = true
    } else if (!parsed) dateFlags = ['date_unknown']
    if (candidate.event_type === 'follow_up_documented') dateFlags = dateFlags.filter((f) => f !== 'date_future') // due dates are meant to be ahead
    for (const f of dateFlags) out[f as EventFlag] = true
    const anchor = eventDate ?? doc?.iso ?? null
    if (anchor && daysBetween(anchor, received) > LATE_RECEIVED_DAYS) out.late_received = true
    if (page.lowConfidence) out.low_confidence = true
    // An OCR'd result value can lose a decimal point (11.4 read as 114): each set of rows is checked against the page
    // image, one by one (binding_uncertain blocks bulk verify).
    if (candidate.event_type === 'lab_results_documented' && page.source === 'ocr') out.binding_uncertain = true
    if (page.source === 'ocr') out.ocr = true
    if (ruleBased) out.rule_based = true
    else out.llm = true
    return {
      eventType: candidate.event_type as EventType, fields, eventDate, datePrecision: precision, dateFlags, documentDate: doc?.iso ?? null,
      extractionMethod: page.source === 'text_layer' ? 'text_layer' : 'ocr_llm', flags: out, evidence,
    }
  })
  const best = new Map<string, DraftEvent>()
  for (const d of all) {
    const k = dedupeKey(d)
    const cur = best.get(k)
    const score = (x: DraftEvent) => (x.flags.date_from_document || !x.eventDate ? 1 : 0)
    if (!cur || score(d) < score(cur) || (score(d) === score(cur) && (d.evidence.pageNo - cur.evidence.pageNo || d.evidence.charStart - cur.evidence.charStart) < 0)) best.set(k, d)
  }
  const drafts = all.filter((d) => best.get(dedupeKey(d)) === d)
  return { gate, drafts }
}

// ---------- injection + whole path ----------

export type Injection = { flagged: boolean; patterns: string[]; hiddenPages: number[]; hiddenChars: number }

/** E-DOC-16: instruction-like text in visible OR hidden text; hidden text is never in the extraction text. */
export function injectionReport(pages: PageRead[]): Injection {
  const visible = detectInjection(pages.map((p) => p.text).join('\n'))
  const hiddenText = pages.map((p) => p.hidden ?? '').join('\n')
  const hidden = detectInjection(hiddenText)
  const hiddenPages = pages.filter((p) => p.hidden).map((p) => p.pageNo)
  const patterns = [...new Set([...visible.hits, ...hidden.hits].map((h) => h.pattern))].sort()
  return { flagged: patterns.length > 0 || hiddenPages.length > 0, patterns, hiddenPages, hiddenChars: hiddenText.trim().length }
}

export type Analysis = { classified: Classified; identified: Identified; method: ExtractionMethodUsed; gate: GateResult; drafts: DraftEvent[]; injection: Injection }

/**
 * The whole pure path, as scripts/eval.ts runs it (process.ts runs the same steps with DB writes in between).
 * `attached`: a person has attached the document despite the header check, as process.ts re-runs it after that
 * decision; only then may an unmatched document go to the model.
 */
export async function analyse(pages: PageRead[], patient: PatientIdentity, receivedAt: Date, llm?: LlmExtractor | null, opts: { augmentRules?: boolean; attached?: boolean } = {}): Promise<Analysis> {
  let classified = classify(pages)
  const identified = identify(pages, classified, patient, receivedAt)
  const ex = await extractCandidates(classified, identified.identity.result === 'match' || opts.attached ? llm : null, opts)
  // Only a model that replaces the rules may re-type the document; in hybrid mode the calibrated classifier stands.
  if (ex.method === 'llm' && ex.llmDocType && ex.llmDocType !== classified.docType) classified = { ...classified, docType: ex.llmDocType, docTypeConfidence: 0.9 }
  const { gate, drafts } = gateAndDate(ex.candidates, classified, identified, receivedAt, ex.method)
  return { classified, identified, method: ex.method, gate, drafts, injection: injectionReport(pages) }
}
