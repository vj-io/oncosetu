// Regex header parser (FR-ID-03, no-LLM path). Every field carries raw offsets into the given page text.
import { findDates } from '../dates'
import { normaliseSex, parseAge } from '../identity'

export interface Span {
  /** Exactly `text.slice(start, end)`. */
  value: string
  start: number
  end: number
}
export interface LabelledSpan extends Span {
  label: string
  /** Offset where the label starts (label..value is a gateable quote). */
  labelStart: number
}

export interface ParsedHeader {
  name?: LabelledSpan
  age?: Span & { years: number | null }
  sex?: Span & { sex: 'M' | 'F' | 'O' }
  dob?: LabelledSpan
  /** Highest-priority hospital identifier (UHID > MRN > CR > Reg > IP > OP > Lab > Patient ID …). */
  mrn?: LabelledSpan
  /** All identifiers found. */
  ids: LabelledSpan[]
  /** Best document date: reported > generic date > collection/received. */
  reportDate?: LabelledSpan
  reportedDate?: LabelledSpan
  collectionDate?: LabelledSpan
  genericDate?: LabelledSpan
  institution?: Span
  referringDoctor?: LabelledSpan
  /** The doctor a document names as in charge (Primary oncologist > Consultant / Treating > Referred by > Admitting). */
  doctor?: LabelledSpan
}

const SEP = String.raw`\s*[:：\-–=.]?\s*`
const STOP = String.raw`(?=\s{2,}|\t|\s*[|,;]|\s*$|\s+(?:Age|Sex|Gender|UHID|MRN|MR\s*No|CR\s*No|Reg|Regn|IP\s*No|IPD|OP\s*No|OPD|Lab\s*No|Lab\s*ID|Patient\s*ID|PID|DOB|D\.O\.B|Date|Ref|Referred|Bill|Visit|Collected|Received|Reported|Sample|उम्र|आयु|लिंग)\b)`

const NAME_LABEL = String.raw`(?<![\p{L}\p{M}])(?:Patient(?:'s)?\s*Name|Pt\.?\s*Name|Name\s+of\s+(?:the\s+)?Patient|(?<!(?:Doctor|Father|Husband|Test|Hospital|Guardian|Consultant|Mother|Spouse|Relative|Kin|Investigation|Specimen|Sample|Institution|Dr|Lab|Centre|Center|Clinic)'?s?\.?[ \t]*)Name|रोगी\s+का\s+नाम|मरीज़?\s+का\s+नाम|नाम)`
const NAME_RE = new RegExp(String.raw`${NAME_LABEL}${SEP}([\p{L}][\p{L}\p{M}.'’ /]*?)${STOP}`, 'gimud')

const AGE_UNIT = String.raw`(?:\s*(?:Y(?:ea)?rs?|Years?|Y|M(?:onths?|ths?)?|D(?:ays?)?|वर्ष|साल)\.?)?`
const AGE_VAL = String.raw`([0-9०-९]{1,3}${AGE_UNIT})`
const SEX_VAL = String.raw`(Male|Female|M|F|Other|TG|O|पुरुष|महिला|स्त्री)(?![\p{L}\p{M}])`
const AGE_SEX = [
  // Age/Sex: 52 Y / F   |   Age / Gender : 52 Yrs / Female
  { re: new RegExp(String.raw`(?<![\p{L}])Age\s*/\s*(?:Sex|Gender)${SEP}${AGE_VAL}\s*[/,\-|]\s*${SEX_VAL}`, 'giu'), age: 1, sex: 2 },
  // Sex/Age: F / 52 Y
  { re: new RegExp(String.raw`(?<![\p{L}])(?:Sex|Gender)\s*/\s*Age${SEP}${SEX_VAL}\s*[/,\-|]\s*${AGE_VAL}`, 'giu'), age: 2, sex: 1 },
  // उम्र/लिंग: 52 वर्ष / महिला
  { re: new RegExp(String.raw`(?:उम्र|आयु)\s*/\s*लिंग${SEP}${AGE_VAL}\s*[/,\-|]\s*${SEX_VAL}`, 'giu'), age: 1, sex: 2 },
  // bare "52 Y / F", "52Y/F", "52 Yrs/Female"
  { re: new RegExp(String.raw`(?<![\p{L}\d])([0-9]{1,3}\s*(?:Y(?:ea)?rs?|Years?|Y)\.?)\s*[/,|]\s*${SEX_VAL}`, 'giu'), age: 1, sex: 2 },
]
const AGE_RE = new RegExp(String.raw`(?<![\p{L}\p{M}])(?:Age|उम्र|आयु)(?:\s*\(\s*Y(?:ea)?rs?\s*\))?${SEP}${AGE_VAL}(?![\d])`, 'giu')
const SEX_RE = new RegExp(String.raw`(?<![\p{L}\p{M}])(?:Sex|Gender|लिंग)${SEP}${SEX_VAL}`, 'giu')

const ID_LABELS: [string, string][] = [
  ['UHID', String.raw`UHID(?:\s*No\.?)?`],
  ['MRN', String.raw`MRN|M\.?R\.?D?\.?\s*No\.?`],
  ['CR No', String.raw`C\.?R\.?\s*No\.?`],
  ['Reg No', String.raw`Reg(?:n|istration)?\.?\s*(?:No\.?|ID)`],
  ['IP No', String.raw`I\.?P\.?D?\.?\s*No\.?`],
  ['OP No', String.raw`O\.?P\.?D?\.?\s*No\.?`],
  ['Lab No', String.raw`Lab\.?\s*(?:No\.?|ID)`],
  ['Patient ID', String.raw`Patient\s*ID|P\.?ID`],
  ['Hospital No', String.raw`Hosp(?:ital)?\.?\s*No\.?`],
  ['Sample ID', String.raw`Sample\s*(?:No\.?|ID)|Accession\s*No\.?`],
  ['पंजीकरण संख्या', String.raw`पंजीकरण\s*(?:सं(?:ख्या)?\.?|नं\.?)`],
]

const DATE_LABELS = {
  reported: String.raw`Report(?:ed)?\s*(?:Date|On|Dt\.?)|Date\s+of\s+Report(?:ing)?|Reporting\s+Date|Reported`,
  collection: String.raw`(?:Sample\s+)?Collect(?:ed|ion)\s*(?:Date|On|Dt\.?)|Date\s+of\s+Collection|Sample\s+Date|Received\s*(?:Date|On)|Registered\s*On|Registration\s+Date|Collected`,
  generic: String.raw`Date\s+of\s+(?:Visit|Consultation|Study|Exam(?:ination)?|Scan|Procedure)|Visit\s+Date|Bill\s+Date|Dated|Date|Dt\.?|दिनांक|तारीख़?`,
}
const DOB_LABEL = String.raw`D\.?O\.?B\.?|Date\s+of\s+Birth|Birth\s*Date|जन्म\s*(?:तिथि|तारीख़?)`
const REF_LABEL = String.raw`Ref(?:\.|erred)?\s*(?:By|Dr\.?|Doctor)|Referring\s+(?:Doctor|Physician|Consultant)|Ref\.?\s*Physician|Consultant|Treating\s+Doctor`
const REF_RE = new RegExp(String.raw`(?<![\p{L}])(${REF_LABEL})${SEP}((?:Dr\.?\s*)?[\p{L}][\p{L}\p{M}.' ]{1,60}?)${STOP}`, 'gimu')

// A doctor named in a header table cell: "Consultant: \tDr. R. S. Joglekar (Medical Oncology)". Name only, never the
// department; it stops at "(", "," or a tab, and before the next cell's label when single-spaced (OCR).
const DOCTOR_LABELS = [
  String.raw`Primary\s+(?:Oncologist|Consultant)|Consultant\s+in\s+charge`,
  String.raw`Consultant|Treating\s+(?:Doctor|Consultant|Physician)`,
  String.raw`Ref(?:\.|erred)?\s*(?:By|Dr\.?|Doctor)|Referring\s+(?:Doctor|Physician|Consultant)`,
  String.raw`Admitting\s+(?:Doctor|Physician|Consultant)`,
]
const DOCTOR_NAME = String.raw`(Dr\.?\s*[\p{L}][\p{L}\p{M}.']*(?:[ ]+(?!(?:Date|Report|Reported|Age|Sex|UHID|Ward|Bed|Cycle|Length|Specimen|Sample|Lab|Reg)\b)[\p{L}][\p{L}\p{M}.']*){0,4})`

const INSTITUTION_WORDS =
  /\b(?:hospital|hospitals|institute|institution|centre|center|clinic|clinics|diagnostics?|laborator(?:y|ies)|labs?|medical|healthcare|health\s*care|pathology|imaging|scans?|cancer|oncology|memorial|trust|college|nursing\s+home|polyclinic|aiims|sansthan|research|foundation)\b|अस्पताल|संस्थान|चिकित्सालय|केंद्र/iu

function lineSpans(text: string): Span[] {
  const out: Span[] = []
  for (const m of text.matchAll(/[^\r\n]*/g)) {
    const raw = m[0]
    const lead = raw.length - raw.trimStart().length
    const value = raw.trim()
    if (value) out.push({ value, start: m.index! + lead, end: m.index! + lead + value.length })
  }
  return out
}

function trimSpan(text: string, start: number, end: number): Span {
  let s = start
  let e = end
  while (s < e && /[\s:：\-–=.,|]/.test(text[s])) s++
  while (e > s && /[\s:：\-–=,|/]/.test(text[e - 1])) e--
  return { value: text.slice(s, e), start: s, end: e }
}

function labelledDate(text: string, labelSrc: string, label: string): LabelledSpan | undefined {
  const re = new RegExp(String.raw`(?<![\p{L}])(?:${labelSrc})(?![\p{L}])`, 'giu')
  for (const m of text.matchAll(re)) {
    const after = m.index! + m[0].length
    const window = text.slice(after, after + 40)
    const d = findDates(window).find((s) => s.kind === 'absolute' && /^[\s:：\-–=.]*$/.test(window.slice(0, s.start)))
    if (d) return { value: d.raw, start: after + d.start, end: after + d.end, label, labelStart: m.index! }
  }
  return undefined
}

/** Parses identity + document-date header fields from one page (normally page 1). */
export function parseHeader(text: string): ParsedHeader {
  const out: ParsedHeader = { ids: [] }

  for (const m of text.matchAll(NAME_RE)) {
    const s = trimSpan(text, m.indices![1][0], m.indices![1][1])
    if (s.value.replace(/[^\p{L}]/gu, '').length >= 2) {
      out.name = { ...s, label: m[0].slice(0, m.indices![1][0] - m.index!).replace(/[\s:：\-–=.]+$/, ''), labelStart: m.index! }
      break
    }
  }

  for (const p of AGE_SEX) {
    const m = new RegExp(p.re.source, p.re.flags + 'd').exec(text)
    if (!m) continue
    const [as, ae] = m.indices![p.age]
    const [ss, se] = m.indices![p.sex]
    const age = trimSpan(text, as, ae)
    out.age = { ...age, years: parseAge(age.value) }
    const sex = normaliseSex(m[p.sex])
    if (sex) out.sex = { value: text.slice(ss, se), start: ss, end: se, sex }
    break
  }
  if (!out.age) {
    const m = new RegExp(AGE_RE.source, AGE_RE.flags + 'd').exec(text)
    if (m) {
      const age = trimSpan(text, m.indices![1][0], m.indices![1][1])
      out.age = { ...age, years: parseAge(age.value) }
    }
  }
  if (!out.sex) {
    const m = new RegExp(SEX_RE.source, SEX_RE.flags + 'd').exec(text)
    const sex = m && normaliseSex(m[1])
    if (m && sex) out.sex = { value: m[1], start: m.indices![1][0], end: m.indices![1][1], sex }
  }

  out.dob = labelledDate(text, DOB_LABEL, 'DOB')

  for (const [label, src] of ID_LABELS) {
    const re = new RegExp(String.raw`(?<![\p{L}])(?:${src})${SEP}([A-Z0-9][A-Z0-9/\-.]{1,24})(?![A-Z0-9])`, 'giud')
    for (const m of text.matchAll(re)) {
      if (!/\d/.test(m[1])) continue
      const v = trimSpan(text, m.indices![1][0], m.indices![1][1])
      out.ids.push({ ...v, label, labelStart: m.index! })
      break
    }
  }
  out.ids.sort((a, b) => a.start - b.start)
  out.mrn = ID_LABELS.map(([l]) => out.ids.find((i) => i.label === l)).find(Boolean)

  out.reportedDate = labelledDate(text, DATE_LABELS.reported, 'reported')
  out.collectionDate = labelledDate(text, DATE_LABELS.collection, 'collection')
  out.genericDate = labelledDate(text, DATE_LABELS.generic, 'date')
  out.reportDate = out.reportedDate ?? out.genericDate ?? out.collectionDate

  const lines = lineSpans(text).slice(0, 8)
  const looksLabel = (l: string) => /[:：]/.test(l) || /^(?:name|age|sex|date|uhid|mrn|page)\b/i.test(l)
  out.institution =
    lines.find((l) => INSTITUTION_WORDS.test(l.value) && !looksLabel(l.value) && l.value.length <= 100) ??
    lines.find((l) => !looksLabel(l.value) && /^[\p{L}\p{M}][\p{L}\p{M}\s.,&'()\-]{3,80}$/u.test(l.value))

  for (const m of text.matchAll(new RegExp(REF_RE.source, REF_RE.flags + 'd'))) {
    const v = trimSpan(text, m.indices![2][0], m.indices![2][1])
    if (/^self$/i.test(v.value)) continue
    out.referringDoctor = { ...v, label: m[1], labelStart: m.index! }
    break
  }

  for (const label of DOCTOR_LABELS) {
    const m = new RegExp(String.raw`(?<![\p{L}])(${label})\s*[:：\-–]?\s*${DOCTOR_NAME}`, 'iud').exec(text)
    if (!m) continue
    out.doctor = { ...trimSpan(text, m.indices![2][0], m.indices![2][1]), label: m[1], labelStart: m.index! }
    break
  }
  return out
}
