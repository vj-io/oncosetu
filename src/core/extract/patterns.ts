// Deterministic event extractor (no-LLM path). Emits the same Candidate shape as the LLM; quotes are exact
// line/sentence spans of the page text, and every field value is a substring of its quote (or, for
// institution_name / test_name, of the first-page header) — so candidates pass the evidence gate.
import { findDates } from '../dates'
import type { Candidate } from '../gate'
import type { DocType } from '../types'
import { parseHeader, type LabelledSpan, type ParsedHeader } from './header'

export interface ExtractPage {
  pageNo: number
  text: string
}

interface Seg {
  page: ExtractPage
  start: number
  end: number
  text: string
}

const MAX_QUOTE = 300
const HEADER_LINES = 15

// ---------- vocabulary ----------

const PROC = new RegExp(
  String.raw`(?<![\p{L}])(?:(?:wide\s+local|local|wide|surgical|anterior|abdomino-?perineal|segmental|transurethral|complete|radical|partial|total|re-?)\s*)?` +
    String.raw`(?:modified\s+radical\s+mastectomy|breast\s+conserving\s+surgery|excision(?:al)?(?:\s+biopsy)?|resection|lumpectomy|[a-z]{3,}ectomy|` +
    String.raw`(?:core\s+needle|core|trucut|tru-cut|incisional|excisional|punch|needle|endoscopic|CT[\s-]guided|USG[\s-]guided|image[\s-]guided)\s+biopsy|biopsy|FNAC|laparotomy|laparoscopy|whipple'?s?\s+procedure|TURBT|MRM|WLE|BCS)` +
    String.raw`(?![\p{L}])(?!\s+(?:report|specimen|slides?|blocks?|sample|tissue))`,
  'giu',
)
const PROC_DONE = /(?<![\p{L}])(?:done|performed|underwent|undergone|s\/p|status\s+post|post|operated|taken\s+up|carried\s+out|h\/o|history\s+of)(?![\p{L}])/iu
const PROC_NOT_DONE = /(?<![\p{L}])(?:advised|advise|plan|planned|recommend\w*|to\s+be\s+done|scheduled|suggested|candidate\s+for|consider\w*|awaiting|will\s+undergo|posted\s+for|planned\s+for)(?![\p{L}])/iu
const SURGERY_DATE_LABEL = /(?:date\s+of\s+(?:surgery|operation|procedure)|surgery\s+date|operation\s+date|DOS)\s*[:\-–]?\s*$/iu

const TESTS = [
  String.raw`ER\s*/\s*PR(?:\s*/\s*HER-?2(?:\s*/\s*neu)?)?`, String.raw`HER-?2(?:\s*/\s*neu)?(?:\s+FISH)?`, String.raw`Ki-?67`, 'IHC', 'immunohistochemistry',
  String.raw`molecular(?:\s+(?:studies|testing|analysis|report|tests?))?`, 'NGS', String.raw`EGFR(?:\s+mutation(?:\s+analysis)?)?`, 'ALK', String.raw`ROS-?1`,
  'KRAS', 'BRAF', String.raw`BRCA\s*1?(?:\s*/\s*2)?`, String.raw`PD-?L1`, 'MSI', 'FISH', 'PCR', String.raw`HPE(?:\s+report)?`,
  String.raw`histopatholog\w*(?:\s+report)?`, String.raw`biopsy\s+report`, String.raw`final\s+(?:HPE\s+)?report`, String.raw`cytology(?:\s+report)?`,
  String.raw`culture(?:\s+report)?`, String.raw`frozen\s+section`, String.raw`bone\s+marrow(?:\s+(?:biopsy|aspiration|report))?`, String.raw`flow\s+cytometry`,
  String.raw`karyotyp\w+`, String.raw`tumou?r\s+markers?`, String.raw`CA[\s-]?125`, String.raw`CA[\s-]?15[.-]3`, 'CEA', 'PSA', 'AFP',
  String.raw`PET[\s-]?CT(?:\s+report)?`, String.raw`CT(?:\s+scan)?\s+report`, String.raw`MRI(?:\s+report)?`, String.raw`USG(?:\s+report)?`, String.raw`bone\s+scan`,
  String.raw`mammogra(?:m|phy)`, String.raw`2D\s*echo`, 'MUGA',
].join('|')
const STATUS = String.raw`to\s+follow|awaited|awaiting|pending|will\s+follow|sent(?:\s+for)?|dispatched|under\s+process|being\s+processed|in\s+process|not\s+(?:yet\s+)?received`
const PENDING_A = new RegExp(String.raw`(?<![\p{L}])(${TESTS})(?![\p{L}])[^.\n;]{0,40}?(?<![\p{L}])(${STATUS})(?![\p{L}])`, 'giu')
const PENDING_B = new RegExp(String.raw`(?<![\p{L}])(awaited|awaiting|pending)\s*[:\-–]?\s*(?:for\s+)?(${TESTS})(?![\p{L}])`, 'giu')
const MOLECULAR = /^(?:molecular|NGS|EGFR|ALK|ROS|KRAS|BRAF|BRCA|PD-?L1|MSI|FISH|PCR)/i

const CYCLE = /(?<![\p{L}])(?:cycle|cy)\.?\s*(?:no\.?\s*)?[:#-]?\s*(\d{1,2})(?!\d)|(?<![\p{L}\d])C\s?(\d{1,2})\s?D\s?(\d{1,2})(?!\d)|(?<![\p{L}\d])(\d{1,2})(?:st|nd|rd|th)\s+cycle(?![\p{L}])/giu
const DRUG_NAMES = /(?<![\p{L}])(?:nab-paclitaxel|paclitaxel|docetaxel|carboplatin|cisplatin|oxaliplatin|5-?FU|fluorouracil|capecitabine|gemcitabine|doxorubicin|adriamycin|epirubicin|cyclophosphamide|trastuzumab|pertuzumab|bevacizumab|pembrolizumab|nivolumab|atezolizumab|etoposide|irinotecan|vincristine|vinorelbine|methotrexate|rituximab|bendamustine|pemetrexed|temozolomide|leucovorin|cetuximab)(?![\p{L}])/iu
const REGIMEN_CODES = /(?<![\p{L}])(?:AC|EC|TC|TCH|TCHP|CMF|FOLFOX|FOLFIRI|FOLFIRINOX|CAPOX|XELOX|R-CHOP|CHOP|ABVD|BEP|FEC|GemCis)(?![\p{L}])/u
const REGIMEN_LABEL = /(?<![\p{L}])(?:regimen|protocol)\s*[:\-–]\s*([^\n;]{2,60}?)(?=\s{2,}|[;\n]|$)/iu
const CHEMO_CONTEXT = /chemo|regimen|infusion|day\s*care|daycare/iu

const RT_WORD = String.raw`[Rr]adiotherapy|RADIOTHERAPY|[Rr]adiation(?:\s+[Tt]herapy)?|RADIATION|EBRT|IMRT|VMAT|IGRT|SBRT|[Bb]rachytherapy|[Cc]hemo-?radiation|CTRT|CCRT|RT`
const RT_DONE = String.raw`[Cc]ompleted|COMPLETED|[Cc]oncluded|[Ff]inished`
const RT_A = new RegExp(String.raw`(?<![\p{L}])(${RT_WORD})(?![\p{L}])[^.\n]{0,60}?(?<![\p{L}])(${RT_DONE})(?![\p{L}])`, 'gu')
const RT_B = new RegExp(String.raw`(?<![\p{L}])(${RT_DONE}|[Cc]ompletion\s+of)\s+(?:[\p{L}]+\s+){0,3}?(${RT_WORD})(?![\p{L}])`, 'gu')
const RT_DATE_LABEL = /(?<![\p{L}])(date\s+of\s+completion|completion\s+date|treatment\s+completed\s+on|completed\s+on)\s*[:\-–]?\s*/giu
const RT_NOT_DONE = /(?<![\p{L}])(?:not|to\s+be|will\s+be|yet\s+to\s+be)\s+complet/iu

const BODY = String.raw`(?:\s+(?:of\s+)?(?:the\s+)?(?:thorax|chest|abdomen\s+(?:and|&)\s+pelvis|abdomen|pelvis|neck|brain|head|whole\s+body|bilateral\s+breasts?|breasts?|spine|liver))?`
const IMAGING = new RegExp(
  String.raw`(?<![\p{L}])(?:(?:PET[\s-]?CT|CECT|NCCT|CT(?:\s+scan)?|MRI|USG|ultrasound|ultrasonography|X-?ray)${BODY}|mammogra(?:m|phy)|sonomammography|bone\s+scan|2D\s*echo|MUGA)(?![\p{L}])(?![\s-]+guided)`,
  'giu',
)
const PATH_MENTION = /(?<![\p{L}])((?:HPE|histopatholog\w*)(?:\s+report)?|biopsy\s+report)\s+(?:dated|dt\.?|on|of)\s+/giu

const REFERRAL = /(?<![\p{L}])(?:referred|refer|referral|ref\.?)\s+to\s+((?:Dr\.?\s*)?[\p{L}][\p{L}\p{M}.&'’\- ]{2,80}?)(?=\s+for(?![\p{L}])|\s+(?:on|dated)\s|[,;:\n(]|\.\s|\.$|$)/giu

const ADMISSION = /(?<![\p{L}])(?:D\.?O\.?A\.?|Date\s+of\s+Admission|Admission\s+Date|Admitted\s+on|Date\s+of\s+Adm\.?)(?![\p{L}])\s*[:\-–]?\s*/giu
const DISCHARGE = /(?<![\p{L}])(?:D\.?O\.?D\.?|Date\s+of\s+Discharge|Discharge\s+Date|Discharged\s+on)(?![\p{L}])\s*[:\-–]?\s*/giu

const MED_LINE = /^\s*(?:\d{1,2}[.)]\s*)?(?:Tab|Tablet|Cap|Capsule|Inj|Injection|Syp|Syr|Syrup|Susp|Oint|Gel|Drops?|Sachet|Neb)\.?\s+([A-Za-z][\w+-]*(?:\s+(?!(?:OD|BD|BID|TDS|TID|QID|HS|SOS|PRN|STAT|x|X|for|after|before|daily|once|twice|thrice|morning|night|with|mg|ml|mcg|g|IU|units?)\b)[A-Za-z][\w+-]*){0,2})/u

const TITLES: Partial<Record<DocType, RegExp>> = {
  pathology_report: /(?<![\p{L}])(?:histopatholog\w*(?:\s+(?:report|examination))?|surgical\s+pathology(?:\s+report)?|biopsy\s+report|cytology\s+report|HPE\s+report|pathology\s+report|frozen\s+section(?:\s+report)?|cytopathology(?:\s+report)?)(?![\p{L}])/iu,
  ihc_molecular_report: /(?<![\p{L}])(?:immunohistochemistry(?:\s+report)?|IHC(?:\s+report)?|molecular\s+(?:pathology|diagnostics|report)|NGS(?:\s+report)?|next[\s-]generation\s+sequencing|EGFR\s+mutation(?:\s+analysis)?|FISH(?:\s+report)?|PD-?L1(?:\s+report)?)(?![\p{L}])/iu,
  imaging_report: IMAGING,
  lab_report: /(?<![\p{L}])(?:complete\s+blood\s+count|CBC|haemogram|hemogram|liver\s+function\s+tests?|LFT|kidney\s+function\s+tests?|KFT|renal\s+function\s+tests?|RFT|lipid\s+profile|thyroid\s+profile|tumou?r\s+markers?|blood\s+sugar|HbA1c|urine\s+routine|coagulation\s+profile|serum\s+[\p{L}]+|CA[\s-]?125|CA[\s-]?15[.-]3|CEA|PSA|biochemistry|haematology|hematology)(?![\p{L}])/iu,
}

// ---------- helpers ----------

function segments(page: ExtractPage): Seg[] {
  const out: Seg[] = []
  for (const m of page.text.matchAll(/[^\n]+/g)) {
    const lineStart = m.index!
    const line = m[0]
    // Split long lines into sentences.
    const parts = line.length > MAX_QUOTE ? [...line.matchAll(/[^.;]+[.;]?/g)].map((p) => [p.index!, p.index! + p[0].length]) : [[0, line.length]]
    for (const [a, b] of parts) {
      const raw = line.slice(a, b)
      const lead = raw.length - raw.trimStart().length
      const text = raw.trim()
      if (text) out.push({ page, start: lineStart + a + lead, end: lineStart + a + lead + text.length, text })
    }
  }
  return out
}

const absDates = (s: string) => findDates(s).filter((d) => d.kind === 'absolute')

/** Date immediately after `offset` in `text` (only separators in between). */
function dateAfter(text: string, offset: number) {
  const window = text.slice(offset, offset + 40)
  const d = absDates(window)[0]
  return d && /^[\s:\-–.]*$/.test(window.slice(0, d.start)) ? { raw: d.raw, start: offset + d.start, end: offset + d.end } : null
}

// ---------- extractor ----------

/** Extracts candidate events from page texts with deterministic patterns. Handwritten prescriptions yield nothing. */
export function extractPatterns(pages: ExtractPage[], docType: DocType, header: ParsedHeader = parseHeader(pages[0]?.text ?? '')): Candidate[] {
  if (docType === 'prescription_handwritten' || !pages.length) return []
  const first = [...pages].sort((a, b) => a.pageNo - b.pageNo)[0]
  const out: Candidate[] = []
  const seen = new Set<string>()
  const headerLineEnd = first.text.split('\n').slice(0, HEADER_LINES).join('\n').length
  const institution = header.institution && header.institution.end <= headerLineEnd ? header.institution.value : undefined

  const add = (event_type: string, page: ExtractPage, start: number, end: number, fields: Record<string, string | string[] | undefined>) => {
    const raw = page.text.slice(start, end)
    const lead = raw.length - raw.trimStart().length
    const quote = raw.trim()
    if (quote.length < 8 || quote.length > MAX_QUOTE) return
    const clean: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && (typeof v === 'string' ? v.trim() : v.length)) clean[k] = typeof v === 'string' ? v.trim() : v
    if (institution) clean.institution_name = institution
    const key = `${event_type}|${page.pageNo}|${start + lead}|${JSON.stringify(clean)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ event_type, fields: clean, quote, page_no: page.pageNo })
  }

  for (const page of pages) {
    const segs = segments(page)
    segs.forEach((seg, i) => {
      const t = seg.text
      const at = (local: number) => seg.start + local

      // Admission / discharge dates
      for (const [re, type] of [[ADMISSION, 'admission_documented'], [DISCHARGE, 'discharge_documented']] as const) {
        for (const m of t.matchAll(re)) {
          const d = dateAfter(t, m.index! + m[0].length)
          if (d) add(type, page, at(m.index!), at(d.end), { event_date_text: d.raw })
        }
      }

      // Procedures
      if (!PROC_NOT_DONE.test(t)) {
        for (const m of t.matchAll(PROC)) {
          const d = absDates(t)[0]
          if (d) {
            add('procedure_documented', page, seg.start, seg.end, { procedure_text: m[0], event_date_text: d.raw })
            continue
          }
          const nb = [segs[i + 1], segs[i - 1]].find((s) => s && s.page === page && SURGERY_DATE_LABEL.test(s.text.slice(0, absDates(s.text)[0]?.start ?? 0)) && absDates(s.text)[0])
          if (nb && Math.max(nb.end, seg.end) - Math.min(nb.start, seg.start) <= MAX_QUOTE) {
            add('procedure_documented', page, Math.min(nb.start, seg.start), Math.max(nb.end, seg.end), { procedure_text: m[0], event_date_text: absDates(nb.text)[0].raw })
          } else if (PROC_DONE.test(t)) add('procedure_documented', page, seg.start, seg.end, { procedure_text: m[0] })
        }
      }

      // Pending / sent reports
      for (const m of [...t.matchAll(PENDING_A)].map((m) => ({ test: m[1], status: m[2], m })).concat([...t.matchAll(PENDING_B)].map((m) => ({ test: m[2], status: m[1], m })))) {
        const sent = /^(?:sent|dispatched)/i.test(m.status)
        const type = sent && MOLECULAR.test(m.test) ? 'molecular_test_documented' : 'report_pending_documented'
        add(type, page, seg.start, seg.end, { test_name: m.test, status_text: m.status, event_date_text: absDates(t)[0]?.raw })
      }

      // Chemotherapy sessions
      if (docType === 'chemo_daycare_record' || CHEMO_CONTEXT.test(t) || DRUG_NAMES.test(t) || REGIMEN_CODES.test(t)) {
        for (const m of t.matchAll(CYCLE)) {
          const cycle = m[1] ?? m[2] ?? m[4]
          const regimen = REGIMEN_LABEL.exec(t)?.[1] ?? t.match(REGIMEN_CODES)?.[0] ?? t.match(DRUG_NAMES)?.[0]
          add('chemotherapy_session_documented', page, seg.start, seg.end, { cycle_number: cycle, regimen_text: regimen, event_date_text: absDates(t)[0]?.raw })
        }
      }

      // Radiotherapy completed
      if (!RT_NOT_DONE.test(t)) {
        const rt = new RegExp(RT_A.source, 'u').exec(t)
        const rtb = rt ? null : new RegExp(RT_B.source, 'u').exec(t)
        if (rt) add('radiotherapy_documented', page, seg.start, seg.end, { treatment_text: rt[1], status_text: rt[2], event_date_text: absDates(t)[0]?.raw })
        else if (rtb) add('radiotherapy_documented', page, seg.start, seg.end, { treatment_text: rtb[2], status_text: rtb[1], event_date_text: absDates(t)[0]?.raw })
        else if (docType === 'radiotherapy_summary') {
          for (const m of t.matchAll(RT_DATE_LABEL)) {
            const d = dateAfter(t, m.index! + m[0].length)
            if (d) add('radiotherapy_documented', page, at(m.index!), at(d.end), { status_text: m[1], event_date_text: d.raw })
          }
        }
      }

      // Imaging mentioned with a date
      const dates = absDates(t)
      if (dates.length) {
        for (const m of t.matchAll(IMAGING)) add('imaging_report_documented', page, seg.start, seg.end, { test_name: m[0], event_date_text: dates[0].raw })
        for (const m of t.matchAll(PATH_MENTION)) {
          const d = dateAfter(t, m.index! + m[0].length)
          if (d) add('pathology_report_documented', page, seg.start, seg.end, { test_name: m[1], event_date_text: d.raw })
        }
      }

      // Referrals
      for (const m of t.matchAll(REFERRAL)) add('referral_documented', page, seg.start, seg.end, { referred_to_text: m[1], event_date_text: dates[0]?.raw })
    })

    // Printed prescription medication blocks
    if (docType === 'prescription_printed') {
      let block: { seg: Seg; name: string }[] = []
      const flush = () => {
        if (block.length) add('prescription_documented', page, block[0].seg.start, block[block.length - 1].seg.end, { medication_names: [...new Set(block.map((b) => b.name))] })
        block = []
      }
      for (const seg of segs) {
        const m = MED_LINE.exec(seg.text)
        if (!m) flush()
        else {
          if (block.length && seg.end - block[0].seg.start > MAX_QUOTE) flush()
          block.push({ seg, name: m[1] })
        }
      }
      flush()
    }
  }

  // Document-level "report documented" event: title (header) + document date line.
  const docEvent: Partial<Record<DocType, string>> = {
    pathology_report: 'pathology_report_documented',
    ihc_molecular_report: 'molecular_test_documented',
    imaging_report: 'imaging_report_documented',
    lab_report: 'lab_report_documented',
    consult_note: 'consultation_documented',
  }
  const type = docEvent[docType]
  if (type) {
    const date: LabelledSpan | undefined = docType === 'lab_report' ? header.collectionDate ?? header.reportDate : header.reportDate
    const titleRe = TITLES[docType]
    const tm = titleRe ? new RegExp(titleRe.source, titleRe.flags.replace('g', '')).exec(first.text) : null
    const title = tm && first.text.slice(0, tm.index).split('\n').length <= HEADER_LINES ? { value: tm[0], start: tm.index, end: tm.index + tm[0].length } : null
    if (date) {
      const s = title ? Math.min(title.start, date.labelStart) : date.labelStart
      const e = title ? Math.max(title.end, date.end) : date.end
      const [qs, qe] = e - s <= MAX_QUOTE ? [s, e] : [date.labelStart, date.end]
      add(type, first, qs, qe, { test_name: type === 'consultation_documented' ? undefined : title?.value, event_date_text: date.value })
    } else if (title && type !== 'consultation_documented') {
      const lineStart = first.text.lastIndexOf('\n', title.start) + 1
      const lineEnd = first.text.indexOf('\n', title.end)
      add(type, first, lineStart, lineEnd === -1 ? first.text.length : lineEnd, { test_name: title.value })
    }
  }
  return out
}
