// Deterministic event extractor (no-LLM path). Emits the same Candidate shape as the LLM; quotes are exact
// line/sentence spans of the page text, and every field value is a substring of its quote (or, for
// institution_name / test_name, of the first-page header) — so candidates pass the evidence gate.
import { findDates } from '../dates'
import type { Candidate } from '../gate'
import type { DocType } from '../types'
import { detectInjection } from './injection'
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
const PROC_NOT_DONE = /(?<![\p{L}])(?:advised|advise|plan|planned|recommend\w*|to\s+be\s+done|scheduled|suggested|candidate\s+for|consider\w*|awaiting|will\s+undergo|posted\s+for|planned\s+for|tentative(?:ly)?|subject\s+to|proposed)(?![\p{L}])/iu
const SURGERY_DATE_LABEL = /(?:date\s+of\s+(?:surgery|operation|procedure)|surgery\s+date|operation\s+date|DOS)\s*[:\-–]?\s*$/iu
// "Procedure: Insertion of a totally implantable venous access port, …" in an operation / procedure note: the label's own value.
const PROC_LABEL = /^(?:Procedure|Operation|Surgery|Name\s+of\s+(?:the\s+)?(?:procedure|operation|surgery))(?:\s+(?:done|performed))?\s*(?:[:：]|\t)\s*(\S[^\n]{2,})/iu
// "Block Received: 18 Mar 2026", "Specimen received on …", "Date of receipt": the day the lab got the tissue, never the day of the operation.
const RECEIPT_LABEL = /(?:(?:blocks?|specimens?|samples?|slides?|tissue)\s+)?(?:received|receipt)(?:\s+(?:date|on|at|by(?:\s+lab)?))?\s*(?:[:\-–]|	)?\s*$|date\s+of\s+(?:receipt|receiving)\s*[:\-–]?\s*$/iu
const PROC_LABEL_DOCS: ReadonlySet<DocType> = new Set(['procedure_note', 'discharge_summary'])

const TESTS = [
  String.raw`ER\s*/\s*PR(?:\s*/\s*HER-?2(?:\s*/\s*neu)?)?`, String.raw`HER-?2(?:\s*/\s*neu)?(?:\s+FISH)?`, String.raw`Ki-?67`, 'IHC', 'immunohistochemistry',
  String.raw`molecular(?:\s+(?:studies|testing|analysis|report|tests?))?`, 'NGS', String.raw`EGFR(?:\s+mutation(?:\s+analysis)?)?`, 'ALK', String.raw`ROS-?1`,
  'KRAS', 'BRAF', String.raw`BRCA\s*1?(?:\s*/\s*2)?`, String.raw`PD-?L1`, 'MSI', 'FISH', 'PCR', String.raw`HPE(?:\s+report)?`,
  String.raw`histopatholog\w*(?:\s+report)?`, String.raw`biopsy\s+report`, String.raw`final\s+(?:HPE\s+)?report`, String.raw`cytology(?:\s+report)?`,
  String.raw`culture(?:\s+report)?`, String.raw`frozen\s+section`, String.raw`bone\s+marrow(?:\s+(?:biopsy|aspiration|report))?`, String.raw`flow\s+cytometry`,
  String.raw`karyotyp\w+`, String.raw`tumou?r\s+markers?`, String.raw`CA[\s-]?125`, String.raw`CA[\s-]?15[.-]3`, 'CEA', 'PSA', 'AFP',
  String.raw`PET[\s-]?CT(?:\s+report)?`, String.raw`CT(?:\s+scan)?\s+report`, String.raw`MRI(?:\s+report)?`, String.raw`USG(?:\s+report)?`, String.raw`bone\s+scan`,
  String.raw`mammogra(?:m|phy)`, String.raw`2D\s*echo`, 'MUGA', String.raw`lab(?:oratory)?(?=\s+reports?(?![\p{L}]))`,
].join('|')
const STATUS = String.raw`to\s+follow|awaited|awaiting|pending|will\s+follow|sent(?:\s+for)?|dispatched|under\s+process|being\s+processed|in\s+process|not\s+(?:yet\s+)?received|(?:will\s+be|to\s+be)\s+(?:reported|issued)\s+separately`
const PENDING_A = new RegExp(String.raw`(?<![\p{L}])(${TESTS})(?![\p{L}])[^.\n;]{0,40}?(?<![\p{L}])(${STATUS})(?![\p{L}])`, 'giu')
const PENDING_B = new RegExp(String.raw`(?<![\p{L}])(awaited|awaiting|pending|sent\s+for)\s*[:\-–]?\s*(?:for\s+)?(${TESTS})(?![\p{L}])`, 'giu')
/** "IHC will be performed on request …", "… if required": an option, not a report on its way. */
const CONDITIONAL = /(?<![\p{L}])(?:on\s+request|if\s+(?:required|needed|indicated|requested))(?![\p{L}])/iu
const MOLECULAR = /^(?:molecular|NGS|EGFR|ALK|ROS|KRAS|BRAF|BRCA|PD-?L1|MSI|FISH|PCR)/i

const CYCLE = /(?<![\p{L}])(?:cycle|cy)\.?\s*(?:no\.?\s*)?[:#-]?\s*(\d{1,2})(?!\d)|(?<![\p{L}\d])C\s?(\d{1,2})\s?D\s?(\d{1,2})(?!\d)|(?<![\p{L}\d])(\d{1,2})(?:st|nd|rd|th)\s+cycle(?![\p{L}])/giu
// Oncology drugs common in India, by class. A name is only ever matched as written (quote-only); nothing is inferred from it.
const DRUG_WORDS = [
  // cytotoxic: taxanes, anthracyclines, platinum, antimetabolites and others
  'nab-paclitaxel', 'paclitaxel', 'docetaxel', 'cabazitaxel', 'carboplatin', 'cisplatin', 'oxaliplatin', '5-?FU', 'fluorouracil', 'capecitabine', 'gemcitabine',
  'doxorubicin', 'adriamycin', 'epirubicin', 'daunorubicin', 'idarubicin', 'mitoxantrone', 'cyclophosphamide', 'ifosfamide', 'etoposide', 'irinotecan', 'topotecan',
  'vincristine', 'vinorelbine', 'vinblastine', 'eribulin', 'methotrexate', 'pemetrexed', 'temozolomide', 'leucovorin', 'bendamustine', 'melphalan', 'busulfan',
  'chlorambucil', 'mercaptopurine', 'hydroxyurea', 'azacitidine', 'decitabine', 'bleomycin', 'dacarbazine', 'lomustine', 'trifluridine',
  // PARP inhibitors, CDK4/6 inhibitors
  'olaparib', 'niraparib', 'talazoparib', 'rucaparib', 'palbociclib', 'ribociclib', 'abemaciclib',
  // endocrine: aromatase inhibitors, SERM / SERD, GnRH, anti-androgens
  'tamoxifen', 'toremifene', 'letrozole', 'anastrozole', 'exemestane', 'fulvestrant', 'goserelin', 'leuprolide', 'leuprorelin', 'triptorelin', 'degarelix',
  'abiraterone', 'enzalutamide', 'apalutamide', 'bicalutamide',
  // HER2, VEGF, EGFR and other targeted agents
  'trastuzumab', 'T-DM1', 'pertuzumab', 'lapatinib', 'neratinib', 'tucatinib', 'bevacizumab', 'ramucirumab', 'cetuximab', 'panitumumab',
  'osimertinib', 'gefitinib', 'erlotinib', 'afatinib', 'crizotinib', 'alectinib', 'brigatinib', 'lorlatinib', 'imatinib', 'dasatinib', 'nilotinib', 'sunitinib', 'sorafenib',
  'lenvatinib', 'pazopanib', 'regorafenib', 'cabozantinib', 'axitinib', 'everolimus', 'ibrutinib', 'venetoclax', 'bortezomib', 'lenalidomide', 'pomalidomide', 'thalidomide',
  'rituximab', 'obinutuzumab', 'daratumumab',
  // immunotherapy
  'pembrolizumab', 'nivolumab', 'atezolizumab', 'durvalumab', 'ipilimumab', 'cemiplimab', 'avelumab', 'dostarlimab', 'toripalimab',
]
const DRUG_NAMES = new RegExp(String.raw`(?<![\p{L}])(?:${DRUG_WORDS.join('|')})(?![\p{L}])`, 'iu')
// Class names as written in a history line ("on PARP inhibitor", "on CDK4/6 inhibitor", "on aromatase inhibitor").
const DRUG_CLASS = /(?<![\p{L}])(?:PARP[\s-]?inhibitors?|PARPi|CDK\s?4\s?\/\s?6\s+inhibitors?|aromatase\s+inhibitors?|(?:immune\s+)?checkpoint\s+inhibitors?|immunotherapy|hormone\s+therapy|endocrine\s+therapy|targeted\s+therapy|anti-?HER-?2\s+therapy)(?![\p{L}])/iu
// A medicine a history line says the patient is on, or has had: "on olaparib", "receiving letrozole", "started tamoxifen in 2023".
const DRUG_HISTORY_CUE = /(?<![\p{L}])(?:on|taking|takes|receiving|received|continues?|continued|currently|since|started|stopped|discontinued|treated\s+with|under\s+treatment|maintenance|adjuvant|neo-?adjuvant|course\s+of|completed|h\/o|k\/c\/o|history\s+of)(?![\p{L}])/iu
const DRUG_HISTORY_SKIP_DOCS: ReadonlySet<DocType> = new Set(['prescription_printed', 'prescription_handwritten', 'chemo_daycare_record', 'lab_report'])
const DRUG_PLAN_CUE = /(?<![\p{L}])(?:advised|advise|plan|planned|recommend\w*|consider\w*|candidate\s+for|to\s+be\s+started|may\s+be\s+started|to\s+start|will\s+(?:start|begin|receive)|suggest\w*|eligible|if\s+(?:required|needed))(?![\p{L}])/iu
const REGIMEN_CODES = /(?<![\p{L}])(?:AC|EC|TC|TCH|TCHP|CMF|FOLFOX|FOLFIRI|FOLFIRINOX|CAPOX|XELOX|R-CHOP|CHOP|ABVD|BEP|FEC|GemCis)(?![\p{L}])/u
const REGIMEN_LABEL = /(?<![\p{L}])(?:regimen|protocol)\s*[:\-–]\s*([^\n;]{2,60}?)(?=\s{2,}|[;\n]|$)/iu
const CHEMO_CONTEXT = /chemo|regimen|infusion|day\s*care|daycare/iu

const RT_WORD = String.raw`[Rr]adiotherapy|RADIOTHERAPY|[Rr]adiation(?:\s+[Tt]herapy)?|RADIATION|EBRT|IMRT|VMAT|IGRT|SBRT|[Bb]rachytherapy|[Cc]hemo-?radiation|CTRT|CCRT|RT`
const RT_DONE = String.raw`[Cc]ompleted|COMPLETED|[Cc]oncluded|[Ff]inished`
const RT_A = new RegExp(String.raw`(?<![\p{L}])(${RT_WORD})(?![\p{L}])[^.\n]{0,60}?(?<![\p{L}])(${RT_DONE})(?![\p{L}])`, 'gu')
const RT_B = new RegExp(String.raw`(?<![\p{L}])(${RT_DONE}|[Cc]ompletion\s+of|[Rr]eceived|[Uu]nderwent)\s+(?:[\p{L}]+\s+){0,3}?(${RT_WORD})(?![\p{L}])`, 'gu')
const RT_DATE_LABEL = /(?<![\p{L}])(date\s+of\s+completion|completion\s+date|treatment\s+completed\s+on|completed\s+on|(?:date\s+of\s+)?last\s+fraction|completed(?=\s*[:\-–]))\s*[:\-–]?\s*/giu
const RT_HISTORY_DOCS: ReadonlySet<DocType> = new Set(['imaging_report', 'pathology_report', 'ihc_molecular_report'])
const RT_NOT_DONE = /(?<![\p{L}])(?:(?:not|to\s+be|will\s+be|yet\s+to\s+be)\s+complet|not\s+(?:yet\s+)?(?:received|undergone))/iu
// In a radiotherapy summary, "Treatment was completed as planned" is the radiotherapy itself.
const RT_SUMMARY_DONE = /(?<![\p{L}])([Tt]reatment|[Cc]ourse)(?![\p{L}])[^.\n]{0,30}?(?<![\p{L}])(completed|concluded|finished)(?![\p{L}])/u

const BODY = String.raw`(?:\s+(?:of\s+)?(?:the\s+)?(?:thorax|chest|abdomen\s+(?:and|&)\s+pelvis|abdomen|pelvis|neck|brain|head|whole\s+body|bilateral\s+breasts?|breasts?|spine|liver))?`
// "ECG / Chest X-ray" is kept as written (the ECG half is not dropped); standalone ECG is not an imaging report.
const IMAGING = new RegExp(
  String.raw`(?<![\p{L}])(?:(?:(?:ECG|EKG)\s*(?:\/|&|and)\s*)?(?:chest\s+)?(?:PET[\s-]?CT|CECT|NCCT|CT(?:\s+scan)?|MRI|USG|ultrasound|ultrasonography|X-?ray)${BODY}|mammogra(?:m|phy)|sonomammography|bone\s+scan|2D\s*echo|MUGA)(?![\p{L}])(?![\s-]+guided)`,
  'giu',
)
// A dated pathology result named in another document: "HPE dated 2/3/2026", "HPE (punch biopsy) dtd 28/03/2026: …",
// "biopsy HPE (08/04/2026): …", "FNAC dated 14/02/2026: Bethesda VI" (the date must follow at once: dateAfter).
const DATED_BY = String.raw`(?:\(\s*(?:reports?\s+)?(?:(?:dated|dtd\.?|dt\.?|on|of)\s+)?|(?:reports?\s+)?(?:dated|dtd\.?|dt\.?|on|of)\s+)`
const PATH_MENTION = new RegExp(String.raw`(?<![\p{L}])((?:HPE|histopatholog\w*)(?:\s+report)?|biopsy\s+report|FNAC|cytology(?:\s+report)?)(?![\p{L}])\s*(?:\([^()\d]{1,40}\)\s*)?${DATED_BY}`, 'giu')
// A dated blood test or tumour marker named in a note: "PSA (12/04/2026): 48 ng/mL", "CBC and RFT (reports of 06/04/2026)".
const LAB_MENTION = new RegExp(String.raw`(?<![\p{L}])(CBC|LFT|RFT|KFT|PSA|CEA|AFP|LDH|TSH|(?:beta|β)[\s-]?hCG|CA[\s-]?125|CA[\s-]?19[.-]9|[Ss]erum\s+creatinine|[Hh]a?emogram|[Cc]omplete\s+blood\s+count)(?![\p{L}])[^.\n:;()]{0,25}?${DATED_BY}`, 'gu')
const LAB_NOT_DONE = /(?<![\p{L}])(?:to\s+be|will\s+be|due|repeat|next|before|planned|advised|awaited|pending)(?![\p{L}])/iu
/** "Addendum to histopathology report dated …" points at the report it amends, which is its own document. */
const AMENDS = /(?:addendum|amendment|corrigendum|supplement(?:ary)?)\s+(?:report\s+)?to\s+$/iu

const REFERRAL = /(?<![\p{L}])(?:referred|refer|referral|ref\.?)\s+to\s+((?:Dr\.?\s*)?[\p{L}][\p{L}\p{M}.&'’\- ]{2,80}?)(?=\s+for(?![\p{L}])|\s+(?:on|dated)\s|[,;:\n(]|\.\s|\.$|$)/giu

const ADMISSION = /(?<![\p{L}])(?:D\.?O\.?A\.?|Date\s+of\s+Admission|Admission\s+Date|Admitted\s+on|Date\s+of\s+Adm\.?|Admitted(?=\s*[:：]))(?![\p{L}])\s*[:\-–]?\s*/giu
const DISCHARGE = /(?<![\p{L}])(?:D\.?O\.?D\.?|Date\s+of\s+Discharge|Discharge\s+Date|Discharged\s+on|Discharged(?=\s*[:：]))(?![\p{L}])\s*[:\-–]?\s*/giu

const ALLERGY = /(?<![\p{L}])(?:(?:no|nil)\s+known\s+(?:drug\s+|food\s+)?allerg(?:y|ies)|NKDA|(?:known\s+)?allergic\s+to\s+[^.;\n\t]{2,60}?(?=\s*(?:[.;\n\t]|$))|allerg(?:y|ies)\s*[:\-–]\s*[^.;\n\t]{2,60}?(?=\s*(?:[.;\n\t]|$)))/iu
// A date already written down for something still to come (review visit, suture removal, dressing, next cycle).
const FOLLOW_UP = /(?<![\p{L}])(?:review|follow[\s-]?up|re-?visit|(?:suture|stitch(?:es)?)\s+removal|removal\s+of\s+(?:sutures|stitches)|(?:wound\s+)?dressing|next\s+(?:visit|review|appointment|cycle)|appointment)(?![\p{L}])/iu
const FOLLOW_UP_PAST = /(?<![\p{L}])(?:was|were|done|performed|completed|reviewed)(?![\p{L}])/iu
const FOLLOW_UP_TAIL = /[\s,:\-–]*(?:(?:on|dated|due|at|by|for)[\s:]*)?$/iu
// A document's own diagnosis and history sections, copied word for word (staff-only, FR-EXT-05): a "Diagnosis" heading
// and its paragraph, or "Diagnosis: …" on one line (table rows); a sentence that opens a history statement.
const DX_HEADING = /^(?:(?:final|provisional|clinical|working)\s+)?diagnos[ie]s\s*:?$/iu
const DX_INLINE = /^(?:(?:final|provisional|clinical|working)\s+)?diagnos[ie]s\s*[:\-–]\s*(\S[\s\S]*)$/iu
// "Clinical history / Indication: ...": the section that holds the cancer history in a radiology or pathology report. Whole section, word for word.
const INDICATION_ATOM = String.raw`(?:clinical\s+)?(?:history|indications?)|clinical\s+(?:details|information|notes?)`
const INDICATION_NAME = String.raw`(?:${INDICATION_ATOM})(?:\s*(?:\/|and|&|,)\s*(?:${INDICATION_ATOM}))*|reason\s+for\s+(?:the\s+)?(?:study|scan|examination|exam|referral)|clinical\s+(?:question|setting)|history\s+given`
const INDICATION_ONLY = new RegExp(String.raw`^\s*(?:${INDICATION_NAME})\s*[:\-–]?\s*$`, 'iu')
const INDICATION_INLINE = new RegExp(String.raw`^\s*(?:${INDICATION_NAME})\s*(?:[:：]|\t|\s[-–]\s)\s*(\S[\s\S]*)$`, 'iu')
const INDICATION_DOCS: ReadonlySet<DocType> = new Set(['imaging_report', 'pathology_report', 'ihc_molecular_report'])
// Words that open the next section of a report; a body line that merely has a colon in it ("Right breast lesion: BIRADS 5") is not one.
const SECTION_WORDS = /^\s*(?:findings?|technique|protocol|comparison|clinical|history|indications?|advice|plan|recommendations?|suggestions?|notes?|addendum|follow[\s-]?up|procedure|summary|diagnosis|conclusion|opinion|impression|limitations?|contrast|study|examination|exam|referr\w*|report(?:ed)?|date|accession|signed|sample|specimen|gross|microscop\w*|investigations?|medications?|treatment)(?![\p{L}])/iu
const LIST_ITEM = /^\s*(?:\d{1,2}[.)]|[a-z][.)]|[•*·-])\s*\S/
/** Is this line the heading of the next section? `prevDone`: the line before it ended a sentence. */
function isSectionHead(t: string, prevDone: boolean): boolean {
  const label = /^\s*([\p{L}][\p{L}\s/&-]{0,40}?)\s*:/u.exec(t)
  if (label) return SECTION_WORDS.test(label[1])
  const bare = t.trim()
  if (!prevDone || bare.length < 4 || bare.length > 48 || /[.;!?]$/.test(bare) || /\d/.test(bare)) return false
  return SECTION_WORDS.test(bare) || (bare === bare.toUpperCase() && /^[\p{Lu}][\p{Lu}\s,&/()'-]+$/u.test(bare))
}
/** End (exclusive) of the longest prefix of text[a, z) that is whole sentences and fits a quote; -1 when there is none. */
function wholeSentencesTo(text: string, a: number, z: number): number {
  if (z - a <= MAX_QUOTE && /[.;!?)]\s*$/.test(text.slice(a, z))) return z
  let best = -1
  for (const m of text.slice(a, Math.min(z, a + MAX_QUOTE)).matchAll(/[.;!?](?=\s|$)/g)) {
    const e = a + m.index! + 1
    if (!ABBREV.test(text.slice(a, e))) best = e
  }
  if (best < 0 && z - a <= MAX_QUOTE) return z // a block that ends without a full stop, as printed
  return best
}
const HEADING_LINE = /^[\p{Lu}][\p{L}\s,&/()'-]{0,48}$/u
const SENTENCE_DONE = /[.;!?]\s*$/
const HISTORY = /^(?:no\s+)?(?:k\/c\/o\b|known\s+(?!(?:drug|food)\b|allerg)|h\/o\b|(?:(?:past|medical|family|surgical)\s+)?history\s+of\b|(?:past|medical|family|surgical)\s+history\s*[:\-–]|co-?morbidit(?:y|ies)\b)/iu
// One lab result row as printed: a test name, a number (with the lab's own H/L mark, if any) and a lab unit
// ("Haemoglobin  11.8 g/dL  12.0 - 15.5 g/dL").
const RESULT_ROW = /^[\s•*-]*([\p{L}][\p{L}\p{M}\d ()/.,'+-]{1,44}?)\s*[:\-–]?\s+[<>]?\s*\d[\d,]*(?:\.\d+)?(?:\s*[HL*](?![\p{L}]))?\s*(?:g\/dl|gm\/dl|gm?%|mg\/dl|mg\/l|mmol\/l|meq\/l|[iu]u\/l|u\/l|iu\/ml|ng\/ml|pg\/ml|[µu]g\/l|[µu]iu\/ml|fl|pg|%|\/\s?cu\.?\s?mm|\/\s?cumm|\/\s?[µu]l|\/\s?mm3|lakhs?|million|x\s?10|sec(?:onds)?|mm\/(?:1st\s+)?hr?)(?![\p{L}])/iu
const RESULT_DOCS: ReadonlySet<DocType> = new Set(['lab_report', 'discharge_summary', 'chemo_daycare_record', 'consult_note', 'procedure_note'])

const MED_LINE = /^\s*(?:\d{1,2}(?:[.)]|\s*\t)\s*)?(?:Tab|TAB|Tablet|Cap|CAP|Capsule|Inj|INJ|Injection|Syp|SYP|Syr|Syrup|Susp|Oint|Gel|Drops?|Sachet|Neb)\.?\s+([A-Za-z][\w+-]*(?:\s+(?!(?:OD|BD|BID|TDS|TID|QID|HS|SOS|PRN|STAT|x|X|for|after|before|daily|once|twice|thrice|morning|night|with|mg|ml|mcg|g|IU|units?)\b)[A-Za-z][\w+-]*){0,2})/u
// A numbered table row whose first cell names the medicine without Tab./Cap./Inj. ("5 <tab>Urea 10% emollient cream <tab>Apply on ...").
// The whole first cell is the name, as written; header rows ("# <tab>Medicine") and rows with no letters never match.
const MED_ROW = /^\s*\d{1,2}\s*\t\s*([\p{L}][^\t\n]{2,70}?)\s*(?:\t|$)/u
const NOT_A_MEDICINE = /^(?:medicine|drug|name|sr\.?\s*no|dose|duration|instructions?)\b/i

// Quote-only oncology lines: each is a sentence or table row copied word for word. Nothing is derived from them.
const STAGE_TOKEN = /(?<![\p{L}\d])(?:[yra]{0,2}[pc]T(?:[0-4]|X|is)[a-d]?(?:\s*[yra]{0,2}[pc]?N(?:[0-3]|X)[a-c]?)?(?:\s*[pc]?M(?:[01]|X)[a-d]?)?|T(?:[0-4]|X|is)[a-d]?\s*N(?:[0-3]|X)[a-c]?(?:\s*M(?:[01]|X))?|[pc]N(?:[0-3]|X)[a-c]?(?:\s*[pc]?M(?:[01]|X))?|[pc]M(?:[01]|X)|FIGO\s+stage\s*(?:[0-4]|[IV]{1,3})[A-C]?\d?|[Ss]tage\s*(?:[0-4]|[IV]{1,3})[A-C]?|TNM)(?![\p{L}\d])/gu
const MARGIN = /(?<![\p{L}])margins?(?![\p{L}])/iu
// An operation note's intended margin ("with a 1 cm bony margin") and a radiotherapy planning margin are not results:
// in those documents a margin line counts only when it states one.
const MARGIN_RESULT = /(?<![\p{L}])(?:free|clear|clearance|negative|positive|involved|uninvolved|close|closest|frozen|R[012])(?![\p{L}\d])/iu
// "Spiculated margins", "a 2.1 cm lesion with irregular margins": the border of a lesion, never a surgical margin.
const MARGIN_SHAPE = /(?<![\p{L}])(?:spiculated|irregular|lobulated|microlobulated|well[\s-]?defined|ill[\s-]?defined|poorly[\s-]?defined|circumscribed|smooth|indistinct|angulated|rim|enhancing|margins?\s+of\s+the\s+(?:lesion|mass|tumou?r|nodule))(?![\p{L}])/iu
const MARGIN_SIZE = /\d(?:\.\d+)?\s*(?:x\s*\d(?:\.\d+)?\s*)*(?:mm|cm)(?![\p{L}])/iu
const MARGIN_DISTANCE = /(?<![\p{L}])(?:from|to|at|within|of)\s+(?:the\s+)?(?:(?:nearest|closest|deep|superficial|radial|circumferential|inked|surgical|resection|medial|lateral|anterior|posterior|superior|inferior|proximal|distal|\w+)\s+){0,3}margins?(?![\p{L}])/iu
const MARGIN_RESULT_DOCS: ReadonlySet<DocType> = new Set(['procedure_note', 'radiotherapy_summary'])
// The delivered course in a radiotherapy summary: "Dose  20 Gy in 5 fractions", "25 Gy / 5 #".
const RT_DOSE = /(?<![\p{L}\d.])\d+(?:\.\d+)?\s*Gy\s*(?:in|\/)\s*\d+\s*(?:fractions?|#|fr\.?)/iu
const MARKER_START = /^\s*(?:(?:Estrogen|Oestrogen)\s+receptor|Progesterone\s+receptor|HER-?2(?:\/neu)?|Ki-?67|ER|PR|MLH1|PMS2|MSH2|MSH6|MSI)(?![\p{L}\d])/iu
const MMR_PROTEIN = /^\s*(?:MLH1|PMS2|MSH2|MSH6)(?![\p{L}\d])/u
const MARKER_RESULT = /POSITIVE|NEGATIVE|DETECTED|Detected|Not detected|Positive|Negative|Equivocal|EQUIVOCAL|Score\s*\d|\d\s*%|[Rr]etained|[Ll]oss\b|[Ll]ost\b|[Ii]ntact|[Pp]roficient|[Dd]eficient|MSI-?(?:H|L)|\bMSS\b/u
const MARKER_NARRATIVE = /(?:evaluated|reported\s+separately|performed\s+on|sent\s+for|as\s+per|guidelines|will\s+be\s+reported)/i
const MMR_STATUS = /\b(?:pMMR|dMMR|MSI-?H|MSI-?L|MSS)\b|mismatch\s+repair\s+(?:proficient|deficient)/iu
const LABEL_NEXT = /^[\p{Lu}][\p{L}\s/().-]{1,40}:/u
const ADDENDUM_TITLE = /^\s*(?:ADDENDUM|AMENDED|CORRIGENDUM|SUPPLEMENTARY)(?:\s+REPORT)?\s*$/
const ADDENDUM_TEST = /(?:immunohistochemistry|IHC|molecular|FISH|NGS)[^.]{0,80}?(?<![\p{L}])(?:was|were)\s+(?:performed|done|carried\s+out)(?![\p{L}])/iu
const ADDENDUM_CHANGE = /(?:diagnosis|report|findings?)[^.]{0,80}?\b(?:unchanged|revised|amended|modified|corrected|changed)\b/i
const IMPRESSION_HEAD = /^\s*(?:impression|conclusion|opinion)\s*:?\s*$/i
const IMPRESSION_INLINE = /^\s*(?:impression|conclusion)\s*[:\-–]\s*(\S[\s\S]*)$/i
// A results table in an IHC / molecular report: "Marker <tab> Result ..." or "Gene region <tab> Result".
const TABLE_HEAD = /^\s*(?:Marker|Gene(?:\s+region)?|Antibody|Test|Parameter)\b[^\t]*\t.*\b(?:Result|Status)\b/i
const IMPRESSION_DOCS: ReadonlySet<DocType> = new Set(['imaging_report', 'pathology_report', 'consult_note'])
const SIGNATURE = /^\s*(?:Dr\.?\s|Prof\.?\s|Reg\.|Consultant\b|Reported\s+by|Dictated\s+by|Typed\s+by|Transcribed|Computer|Verified|Electronically|Digitally|E-?signed|Signed\b|Authori[sz]ed|Report\s+status|Printed\s+(?:on|by)|This\s+(?:is\s+a\s+)?(?:report|computer)|Disclaimer|Page\s+\d|(?:MD|DNB|MBBS|DMRD|DM|MCh)\b|(?:Consultant\s+)?(?:Radiologist|Pathologist|Oncologist)\b|\*{2,}|\+\s*End)/i
// A signature block or report-status footer inside a quote ("... follow-up advised.  Dr. A B, MD   Report status: Final"):
// it is cut off, with everything after it. It counts only where a line or sentence has ended (or after a tab or a wide gap), so
// "referred to Dr. A" in the middle of a sentence is untouched.
const FOOTER_STRONG = /(?<![\p{L}])(?:Reported[ \t]+by(?![\p{L}])|Dictated[ \t]+by(?![\p{L}])|Electronically[ \t]+(?:signed|verified|authenticated)|Digitally[ \t]+signed|E-?signed|Report[ \t]+status(?![\p{L}])|Verified[ \t]+by(?![\p{L}])|Authori[sz]ed[ \t]+by(?![\p{L}])|Printed[ \t]+(?:on|by)(?![\p{L}])|Signed[ \t]+(?:by|on)(?![\p{L}])|Consultant[ \t]+(?:Radiologist|Pathologist|Oncologist)(?![\p{L}])|This[ \t]+(?:is[ \t]+a[ \t]+)?computer[ \t-]*generated)/giu
const FOOTER_DOCTOR = /(?<![\p{L}])(?:Dr|Prof)\.?[ \t]+\p{Lu}/gu
/** A study the report refers back to: "compared with prior MRI dated ...", "previous CT of ...". */
const PRIOR_CUE = /(?<![\p{L}])(?:compar\w*|prior|previous(?:ly)?|earlier|baseline|vide)(?![\p{L}])/iu
const REGIMEN_PART = /(?<![\p{L}])(Regimen|Protocol)(?:\s*:\s*|[ ]*\t\s*)/iu

const SEEN_BY = /^\s*(?:Seen\s+by|Consulting\s+(?:doctor|physician|oncologist)|Consultant|Doctor|Treating\s+(?:doctor|consultant)|Oncologist)\s*[:：]/iu
const SEEN_BY_INLINE = new RegExp(SEEN_BY.source.replace('^\\s*', '(?<![\\p{L}])'), 'iu') // later on the date's own line

const TITLES: Partial<Record<DocType, RegExp>> = {
  pathology_report: /(?<![\p{L}])(?:histopatholog\w*(?:\s+(?:report|examination))?|surgical\s+pathology(?:\s+report)?|biopsy\s+report|cytology\s+report|HPE\s+report|pathology\s+report|frozen\s+section(?:\s+report)?|cytopathology(?:\s+report)?)(?![\p{L}])/iu,
  ihc_molecular_report: /(?<![\p{L}])(?:immunohistochemistry(?:\s+report)?|IHC(?:\s+report)?|molecular\s+(?:pathology|diagnostics|report)|NGS(?:\s+report)?|next[\s-]generation\s+sequencing|EGFR\s+mutation(?:\s+analysis)?|FISH(?:\s+report)?|PD-?L1(?:\s+report)?)(?![\p{L}])/iu,
  imaging_report: IMAGING,
  consult_note: /(?<![\p{L}])(?:(?:out-?\s?patient\s+)?consultation\s+(?:note|record|sheet)|OPD\s+(?:notes?|record|card|consultation)|(?:OP|OPD)\s+consultation|clinic\s+note|follow[\s-]?up\s+note)(?![\p{L}])/iu,
  lab_report: /(?<![\p{L}])(?:complete\s+blood\s+count|CBC|haemogram|hemogram|liver\s+function\s+tests?|LFT|kidney\s+function\s+tests?|KFT|renal\s+function\s+tests?|RFT|lipid\s+profile|thyroid\s+profile|tumou?r\s+markers?|blood\s+sugar|HbA1c|urine\s+routine|coagulation\s+profile|serum\s+[\p{L}]+|CA[\s-]?125|CA[\s-]?15[.-]3|CEA|PSA|biochemistry|haematology|hematology)(?![\p{L}])/iu,
}

// ---------- helpers ----------

// "Tab. Thyroxine", "Dr. Meera", "Reg. No.", initials, list numbers ("1. Tab."): a full stop that does not end a sentence.
const ABBREV = /(?:(?:^|[^\p{L}])(?:Dr|Drs|Mr|Mrs|Ms|Smt|Shri|Sh|Prof|Tab|Cap|Inj|Syp|Syr|No|Nos|Reg|Hosp|Dt|St|Sr|Jr|Pvt|Ltd|Co|vs|approx|Ref|Wt|Ht|\p{Lu})|(?:^|[^\p{L}\d])\d{1,2})\.$/u
const DATE_INTRO = /(?:^|[^\p{L}])(?:on|dated|dt\.?|date|from|since|till|until|upto|w\.e\.f\.?|by|before|after|of)\s*[:\-–]?\s*$/iu
const SENTENCE_END = /[.;!?]\s+(?=[\p{Lu}(•"“])/gu

/**
 * Sentence segments. A line that starts in lower case continues the previous line's sentence (wrapped text), so a
 * quote never starts mid-sentence ("drug allergies. CT thorax …" was the bug). Table rows and headings start a new
 * line in upper case or a digit and stay whole. A sentence longer than a quote falls back to its lines.
 */
function segments(page: ExtractPage): Seg[] {
  const lines = [...page.text.matchAll(/[^\n]+/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }))
  const blocks: { start: number; end: number; lines: typeof lines }[] = []
  for (const l of lines) {
    const prev = blocks.at(-1)
    const text = page.text.slice(l.start, l.end)
    const before = prev ? page.text.slice(prev.start, prev.end) : ''
    // A line that starts in lower case continues the sentence; so does a date on the next line when the sentence ends
    // on a word that introduces one ("... wide local excision done on" / "12/03/2026").
    const dateNext = DATE_INTRO.test(before) && /^\s*(?:\d{1,2}[\s/.-]|\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s.,])/i.test(text)
    if (prev && (dateNext || (/^\s*\p{Ll}/u.test(text) && !/[.:;!?]\s*$/.test(before)))) {
      prev.end = l.end
      prev.lines.push(l)
    } else blocks.push({ start: l.start, end: l.end, lines: [l] })
  }
  const out: Seg[] = []
  const push = (a: number, b: number) => {
    const raw = page.text.slice(a, b)
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text) out.push({ page, start: a + lead, end: a + lead + text.length, text })
  }
  for (const b of blocks) {
    const body = page.text.slice(b.start, b.end)
    const cuts = [0]
    for (const m of body.matchAll(SENTENCE_END)) if (m[0][0] !== '.' || !ABBREV.test(body.slice(0, m.index! + 1))) cuts.push(m.index! + 1)
    cuts.push(body.length)
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [a, z] = [b.start + cuts[i], b.start + cuts[i + 1]]
      if (z - a <= MAX_QUOTE || b.lines.length === 1) {
        // A single overlong line keeps the old split (sentences on . and ;) so nothing is lost to the quote cap.
        if (z - a > MAX_QUOTE) for (const p of page.text.slice(a, z).matchAll(/[^.;]+[.;]?/g)) push(a + p.index!, a + p.index! + p[0].length)
        else push(a, z)
      } else for (const l of b.lines) if (l.end > a && l.start < z) push(Math.max(l.start, a), Math.min(l.end, z))
    }
  }
  return out
}

/** Lines of a page with their offsets (blank lines included, so a blank line can end a block). */
function lineSpans(text: string) {
  const out: { start: number; end: number; text: string }[] = []
  let at = 0
  for (const t of text.split('\n')) {
    out.push({ start: at, end: at + t.length, text: t })
    at += t.length + 1
  }
  return out
}

/**
 * Cuts a signature block or report-status footer off the end of a quote. Returns the length of the part to keep.
 * "Dr. A B" counts only after a sentence end, a line break, a tab or a wide gap (and only when little follows it).
 */
function keepLength(quote: string): number {
  let cut = quote.length
  const boundary = (at: number) => {
    const before = quote.slice(0, at)
    const gap = /[ \t\n]*$/.exec(before)![0]
    return before.trimEnd().length > 0 && (/[\n\t]|  /.test(gap) || /[.;!?]$/.test(before.trimEnd()))
  }
  for (const m of quote.matchAll(FOOTER_STRONG)) if (boundary(m.index!)) cut = Math.min(cut, m.index!)
  for (const m of quote.matchAll(FOOTER_DOCTOR)) {
    const rest = quote.length - m.index!
    if (boundary(m.index!) && (rest <= 80 || /[.;!?]$/.test(quote.slice(0, m.index!).trimEnd()))) cut = Math.min(cut, m.index!)
  }
  return quote.slice(0, cut).trimEnd().replace(/[,\-–:]$/, '').trimEnd().length
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
  const chemoRegimenSegs = new Set<number>() // lines whose regimen text already sits on a cycle event
  const headerLineEnd = first.text.split('\n').slice(0, HEADER_LINES).join('\n').length
  const institution = header.institution && header.institution.end <= headerLineEnd ? header.institution.value : undefined

  const add = (event_type: string, page: ExtractPage, start: number, end: number, fields: Record<string, string | string[] | undefined>) => {
    const raw = page.text.slice(start, end)
    const lead = raw.length - raw.trimStart().length
    let quote = raw.trim()
    const clean: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && (typeof v === 'string' ? v.trim() : v.length)) clean[k] = typeof v === 'string' ? v.trim() : v
    // No signature block or report-status footer in a quote, unless a field value sits in the part that would be cut.
    const kept = keepLength(quote)
    if (kept < quote.length && kept >= 8) {
      const head = quote.slice(0, kept).replace(/\s+/g, ' ')
      const tail = quote.slice(kept).replace(/\s+/g, ' ').trim()
      // A quote-only field that ends with the cut-off part (it is a copy of the quote) loses it too.
      const cutField = (v: string) => (v.replace(/\s+/g, ' ').endsWith(tail) ? v.replace(/\s+/g, ' ').slice(0, -tail.length).trim() : v)
      const trimmed = Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, typeof v === 'string' && k !== 'institution_name' ? cutField(v) : v]))
      const flat = (v: string | string[]) => (typeof v === 'string' ? [v] : v)
      if (Object.entries(trimmed).every(([k, v]) => k === 'institution_name' || flat(v).every((x) => x.length > 0 && head.includes(x.replace(/\s+/g, ' '))))) {
        quote = quote.slice(0, kept)
        Object.assign(clean, trimmed)
      }
    }
    if (quote.length < 8 || quote.length > MAX_QUOTE) return
    if (institution) clean.institution_name = institution
    const key = `${event_type}|${page.pageNo}|${start + lead}|${JSON.stringify(clean)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ event_type, fields: clean, quote, page_no: page.pageNo })
  }

  for (const page of pages) {
    const segs = segments(page)

    // Diagnosis sections: the heading and its paragraph (the next sentences on the same line, or wrapped mid-sentence)
    const inDx = new Set<Seg>()
    segs.forEach((seg, i) => {
      const inline = DX_INLINE.exec(seg.text)
      if (inline) return add('diagnosis_documented', page, seg.start, seg.end, { section_text: inline[1].replace(/\s+/g, ' ') })
      if (!DX_HEADING.test(seg.text)) return
      const body: Seg[] = []
      for (const s of segs.slice(i + 1)) {
        const prev = body.at(-1)
        if (prev && SENTENCE_DONE.test(prev.text) && page.text.slice(prev.end, s.start).includes('\n')) break
        if ((prev && HEADING_LINE.test(s.text)) || s.end - seg.start > MAX_QUOTE) break
        body.push(s)
      }
      if (!body.length) return
      for (const s of body) inDx.add(s)
      add('diagnosis_documented', page, seg.start, body.at(-1)!.end, { section_text: page.text.slice(body[0].start, body.at(-1)!.end).replace(/\s+/g, ' ') })
    })

    // Clinical history / indication section of a scan or pathology report: the cancer history as the document wrote it.
    // Staff-only diagnosis-as-written fact; the section's whole paragraph up to the next heading (whole sentences, one quote).
    if (INDICATION_DOCS.has(docType)) {
      const L = lineSpans(page.text)
      for (let i = 0; i < L.length; i++) {
        const only = INDICATION_ONLY.test(L[i].text)
        const inline = only ? null : INDICATION_INLINE.exec(L[i].text)
        if (!only && !inline) continue
        let last = inline ? i : -1
        let bodyStart = inline ? L[i].start + L[i].text.length - inline[1].length : -1
        for (let k = i + 1; k < L.length && k - i <= 30; k++) {
          const t = L[k].text
          const prevDone = last < 0 || /[.;!?]\s*$/.test(L[last].text)
          if (!t.trim()) {
            const next = L.slice(k + 1).find((x) => x.text.trim())
            if (last < 0) continue
            if (!next || (prevDone && !LIST_ITEM.test(next.text)) || SIGNATURE.test(next.text) || isSectionHead(next.text, prevDone)) break
            continue
          }
          if (SIGNATURE.test(t) || isSectionHead(t, prevDone) || INDICATION_ONLY.test(t) || INDICATION_INLINE.test(t)) break
          if (last >= 0 && prevDone && t.trim().length < 12 && !/[.:;]\s*$/.test(t)) break // OCR noise after a finished sentence
          if (last < 0) bodyStart = L[k].start
          last = k
          if (L[k].end - L[i].start > 4 * MAX_QUOTE) break
        }
        if (last < 0) continue
        const end = wholeSentencesTo(page.text, L[i].start, L[last].end)
        if (end < 0 || end <= bodyStart) continue
        if (detectInjection(page.text.slice(L[i].start, end)).flagged) continue
        add('diagnosis_documented', page, L[i].start, end, { section_text: page.text.slice(bodyStart, end).replace(/\s+/g, ' ').trim() })
        for (const sg of segs) if (sg.start < end && sg.end > L[i].start) inDx.add(sg)
        i = last
      }
    }

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

      const pathRefs = [...t.matchAll(PATH_MENTION)].map((m) => ({ m, d: dateAfter(t, m.index! + m[0].length) })).filter((x) => x.d && !AMENDS.test(t.slice(0, x.m.index!)))

      // Procedures: a labelled "Procedure:" line, dated by the note's "Date of surgery / procedure" line nearby
      const pl = PROC_LABEL_DOCS.has(docType) ? PROC_LABEL.exec(t) : null
      if (pl && !PROC_NOT_DONE.test(t)) {
        const what = pl[1].split(/[,;(]|\s+(?:under|with|via|using)\s+/)[0].trim()
        const own = absDates(t)[0]
        const nb = own ? null : segs.slice(Math.max(0, i - 3), i + 4).find((s) => s !== seg && s.page === page && SURGERY_DATE_LABEL.test(s.text.slice(0, absDates(s.text)[0]?.start ?? 0)) && absDates(s.text)[0])
        if (own) add('procedure_documented', page, seg.start, seg.end, { procedure_text: what, event_date_text: own.raw })
        else if (nb && Math.max(nb.end, seg.end) - Math.min(nb.start, seg.start) <= MAX_QUOTE) add('procedure_documented', page, Math.min(nb.start, seg.start), Math.max(nb.end, seg.end), { procedure_text: what, event_date_text: absDates(nb.text)[0].raw })
        else add('procedure_documented', page, seg.start, seg.end, { procedure_text: what })
      }
      if (!pl && !PROC_NOT_DONE.test(t)) {
        // One procedure item per sentence: "composite resection (wide excision + segmental mandibulectomy) + neck dissection"
        // is one operation, quoted whole, not three.
        for (const m of [...t.matchAll(PROC)].slice(0, 1)) {
          if (pathRefs.length && /biopsy|FNAC/i.test(m[0])) continue // "biopsy HPE (08/04/2026): adenocarcinoma" is the report
          const d = absDates(t).find((x) => !RECEIPT_LABEL.test(t.slice(0, x.start)))
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
        if (CONDITIONAL.test(t)) continue
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
          if (regimen) chemoRegimenSegs.add(seg.start)
        }
      }

      // Radiotherapy completed. A scan or pathology report only mentions treatment in its history ("post radiotherapy changes",
      // "status post radiotherapy"): that is the history line, not a radiotherapy record.
      if (!RT_NOT_DONE.test(t) && !RT_HISTORY_DOCS.has(docType) && !inDx.has(seg)) {
        const rt = new RegExp(RT_A.source, 'u').exec(t)
        const rtb = rt ? null : new RegExp(RT_B.source, 'u').exec(t)
        if (rt) add('radiotherapy_documented', page, seg.start, seg.end, { treatment_text: rt[1], status_text: rt[2], event_date_text: absDates(t)[0]?.raw })
        else if (rtb) add('radiotherapy_documented', page, seg.start, seg.end, { treatment_text: rtb[2], status_text: rtb[1], event_date_text: absDates(t)[0]?.raw })
        else if (docType === 'radiotherapy_summary') {
          for (const m of t.matchAll(RT_DATE_LABEL)) {
            const d = dateAfter(t, m.index! + m[0].length)
            if (d) add('radiotherapy_documented', page, at(m.index!), at(d.end), { status_text: m[1], event_date_text: d.raw })
          }
          const sd = RT_SUMMARY_DONE.exec(t)
          if (sd) add('radiotherapy_documented', page, seg.start, seg.end, { treatment_text: sd[1], status_text: sd[2], event_date_text: absDates(t)[0]?.raw })
        }
      }

      // Imaging mentioned with a date
      const dates = absDates(t)
      if (dates.length) {
        // "MRI brain on 14 Nov 2026, compared with prior MRI dated 12 Feb 2025": each study takes the date written right after it.
        const studies = [...t.matchAll(IMAGING)]
        const prior = PRIOR_CUE.test(t)
        studies.forEach((m, j) => {
          const from = m.index! + m[0].length
          const own = prior ? dates.find((x) => x.start >= from && x.start < (studies[j + 1]?.index ?? t.length) && x.start - from <= 40) : undefined
          add('imaging_report_documented', page, seg.start, seg.end, { test_name: m[0], event_date_text: (own ?? dates[0]).raw })
        })
        for (const { m, d } of pathRefs) add('pathology_report_documented', page, seg.start, seg.end, { test_name: m[1], event_date_text: d!.raw })
        if (docType !== 'lab_report' && !LAB_NOT_DONE.test(t)) {
          for (const m of t.matchAll(LAB_MENTION)) {
            const d = dateAfter(t, m.index! + m[0].length)
            if (d) add('lab_report_documented', page, seg.start, seg.end, { test_name: m[1], event_date_text: d.raw })
          }
        }
      }

      // Referrals
      for (const m of t.matchAll(REFERRAL)) add('referral_documented', page, seg.start, seg.end, { referred_to_text: m[1], event_date_text: dates[0]?.raw })

      // Allergy statements, word for word ("No known drug allergies", "Allergic to sulpha drugs")
      const al = ALLERGY.exec(t)
      if (al) add('allergy_documented', page, seg.start, seg.end, { allergy_text: al[0].replace(/\s+/g, ' '), event_date_text: dates[0]?.raw })

      // Follow-up dates already written down: the text before the date names what is due
      const fu = FOLLOW_UP.exec(t)
      // "was / done" before the date means it already happened ("Dressing was done on ..."); after it ("... done one day before") it does not.
      const due = fu ? dates.find((d) => d.start > fu.index && !FOLLOW_UP_PAST.test(t.slice(fu.index, d.start))) : undefined
      if (fu && due) {
        const what = t.slice(fu.index, due.start).replace(FOLLOW_UP_TAIL, '')
        add('follow_up_documented', page, seg.start, seg.end, { appointment_text: (what.length <= 80 ? what : fu[0]).replace(/\s+/g, ' '), event_date_text: due.raw })
      }

      // History statements ("Known hypothyroidism on …"), word for word; a diagnosis paragraph already holds its own
      if (!inDx.has(seg) && HISTORY.test(t)) add('history_documented', page, seg.start, seg.end, { history_text: t.replace(/\s+/g, ' ') })
      // A history line that names an oncology medicine the patient is on or has had ("on olaparib", "on PARP inhibitor"), word for
      // word. A plan ("advised letrozole"), a prescription line, a cycle line and a chemotherapy record are not history.
      else if (
        !inDx.has(seg) && !DRUG_HISTORY_SKIP_DOCS.has(docType) && (DRUG_NAMES.test(t) || DRUG_CLASS.test(t)) && DRUG_HISTORY_CUE.test(t) &&
        !DRUG_PLAN_CUE.test(t) && !PROC_NOT_DONE.test(t) && !MED_LINE.test(t) && !MED_ROW.test(t) && !new RegExp(CYCLE.source, 'iu').test(t) &&
        !detectInjection(t).flagged
      ) add('history_documented', page, seg.start, seg.end, { history_text: t.replace(/\s+/g, ' ') })
    })

    // ---- Quote-only oncology lines (stage, margins, marker rows, addendum, impression, regimen) ----
    const addendumDoc = page.text.split('\n').slice(0, HEADER_LINES).some((l) => ADDENDUM_TITLE.test(l))

    // Text that tries to give the software orders is never turned into a fact: the quote-only lines below skip it.
    const clean = segs.filter((s) => !detectInjection(s.text).flagged)

    // Stage as written: the TNM / stage words themselves (the whole sentence when the words alone are too short for a quote)
    for (const seg of clean) {
      const groups: { a: number; z: number }[] = []
      for (const m of seg.text.matchAll(STAGE_TOKEN)) {
        const [a, z] = [m.index!, m.index! + m[0].length]
        const last = groups.at(-1)
        if (last && /^[\s,;/-]{0,3}$/.test(seg.text.slice(last.z, a))) last.z = z
        else groups.push({ a, z })
      }
      for (const g of groups) {
        const [qa, qz] = g.z - g.a >= 8 ? [seg.start + g.a, seg.start + g.z] : [seg.start, seg.end]
        add('stage_documented', page, qa, qz, { section_text: page.text.slice(qa, qz).replace(/\s+/g, ' ') })
      }
    }

    // Margins as written: the sentence that names the margin
    for (const seg of clean) {
      if (!MARGIN.test(seg.text) || HEADING_LINE.test(seg.text)) continue
      let from = 0
      for (const part of seg.text.split(/(?<=[.;!?])\s+/)) {
        const at = seg.text.indexOf(part, from)
        from = at + part.length
        if (!MARGIN.test(part) || (MARGIN_RESULT_DOCS.has(docType) && !MARGIN_RESULT.test(part))) continue
        // A lesion's border or size is not a margin result; a scan report states no surgical margin unless it says so in a result word.
        const result = MARGIN_RESULT.test(part)
        if (docType === 'imaging_report' && (!result || MARGIN_SHAPE.test(part) || MARGIN_SIZE.test(part))) continue
        if (!result && (MARGIN_SHAPE.test(part) || (MARGIN_SIZE.test(part) && !MARGIN_DISTANCE.test(part)))) continue
        add('margins_documented', page, seg.start + at, seg.start + from, { margins_text: part.replace(/\s+/g, ' ') })
      }
    }

    // Marker result rows (ER, PR, HER2, Ki-67, MMR proteins): each row is one quote; adjacent MMR protein rows share one
    const ls = lineSpans(page.text)
    {
      const rows: { start: number; end: number; mmr: boolean }[] = []
      for (let i = 0; i < ls.length; i++) {
        if (!MARKER_START.test(ls[i].text)) continue
        let k = i
        while (k < ls.length - 1 && k - i < 5) {
          const next = ls[k + 1].text
          if (/[.]\s*$/.test(ls[k].text) || !next.trim() || MARKER_START.test(next) || LABEL_NEXT.test(next) || SIGNATURE.test(next)) break
          k++
        }
        const [start, end] = [ls[i].start, ls[k].end]
        const text = page.text.slice(start, end)
        i = k
        if (detectInjection(text).flagged) continue
        if (!MARKER_RESULT.test(text) || MARKER_NARRATIVE.test(text) || text.length > MAX_QUOTE) continue
        rows.push({ start, end, mmr: MMR_PROTEIN.test(text) })
      }
      // A results table: each line with a result is a row; consecutive rows of the table share one quote (up to the quote cap)
      if (docType === 'ihc_molecular_report') {
        const th = ls.findIndex((l) => TABLE_HEAD.test(l.text))
        if (th >= 0) {
          const taken = (a: number, z: number) => rows.some((r) => a < r.end && z > r.start)
          let run: { start: number; end: number; mmr: boolean } | null = null
          const flushRun = () => {
            if (run) rows.push(run)
            run = null
          }
          for (let k = th + 1; k < ls.length; k++) {
            let z = k
            while (z + 1 < ls.length && /^\s*\p{Ll}/u.test(ls[z + 1].text)) z++ // wrapped cell continues on a lower-case line
            const text = page.text.slice(ls[k].start, ls[z].end)
            if (!ls[k].text.trim() || !/\t/.test(ls[k].text) || LABEL_NEXT.test(ls[k].text) || !MARKER_RESULT.test(text) || MARKER_NARRATIVE.test(text)) {
              flushRun()
              if (!ls[k].text.trim() || !/\t/.test(ls[k].text)) break
              continue
            }
            if (taken(ls[k].start, ls[z].end)) {
              flushRun()
            } else if (run && ls[z].end - run.start <= MAX_QUOTE) run.end = ls[z].end
            else {
              flushRun()
              run = { start: ls[k].start, end: ls[z].end, mmr: false }
            }
            k = z
          }
          flushRun()
        }
      }
      const merged: typeof rows = []
      for (const r of rows.sort((a, b) => a.start - b.start)) {
        const last = merged.at(-1)
        if (last && last.mmr && r.mmr && /^\s*$/.test(page.text.slice(last.end, r.start)) && r.end - last.start <= MAX_QUOTE) last.end = r.end
        else merged.push({ ...r })
      }
      for (const r of merged) add('marker_results_documented', page, r.start, r.end, { marker_text: page.text.slice(r.start, r.end).replace(/\s+/g, ' ') })
    }

    // Addendum: what the addendum says about the original report, and its stated mismatch-repair interpretation
    if (addendumDoc) {
      clean.forEach((seg, i) => {
        if (ADDENDUM_TITLE.test(seg.text)) {
          const body = segs[i + 1]
          if (body && !/^(?:Marker|Patient|Addendum to)/i.test(body.text)) add('addendum_documented', page, body.start, body.end, { addendum_text: body.text.replace(/\s+/g, ' ') })
        } else if (ADDENDUM_CHANGE.test(seg.text) && !/^\s*(?:Addendum|Original)/i.test(seg.text)) {
          add('addendum_documented', page, seg.start, seg.end, { addendum_text: seg.text.replace(/\s+/g, ' ') })
        }
        if (/^\s*Interpretation\s*:/i.test(seg.text) && MMR_STATUS.test(seg.text)) add('marker_results_documented', page, seg.start, seg.end, { marker_text: seg.text.replace(/\s+/g, ' ') })
      })
    } else if (docType === 'ihc_molecular_report') {
      // The pathologist's own "Interpretation:" sentence, word for word
      for (const seg of clean) if (/^\s*Interpretation\s*:\s*\S/i.test(seg.text)) add('impression_documented', page, seg.start, seg.end, { section_text: seg.text.replace(/^\s*Interpretation\s*:\s*/i, '').replace(/\s+/g, ' ') })
    }

    // Imaging impression: the report's own impression block, word for word, up to the next heading. A block longer than one
    // quote is kept whole as consecutive quotes that each end at a sentence end (never cut mid-sentence).
    if (IMPRESSION_DOCS.has(docType)) {
      for (let i = 0; i < ls.length; i++) {
        const l = ls[i]
        const inline = IMPRESSION_INLINE.exec(l.text)
        const head = IMPRESSION_HEAD.test(l.text)
        if (!inline && !head) continue
        let last = i
        for (let k = i + 1; k < ls.length && k - i <= 40; k++) {
          const t = ls[k].text
          const prevDone = last > i || !head ? /[.;!?]\s*$/.test(ls[last].text) : true
          if (!t.trim()) {
            const next = ls.slice(k + 1).find((x) => x.text.trim())
            if (head && last === i) continue
            if (!next || SIGNATURE.test(next.text) || isSectionHead(next.text, prevDone) || (prevDone && !LIST_ITEM.test(next.text))) break
            continue
          }
          if (SIGNATURE.test(t) || isSectionHead(t, prevDone) || (prevDone && t.trim().length < 12 && !/[.:;]\s*$/.test(t))) break
          last = k
        }
        if (head && last === i) continue
        const blockEnd = ls[last].end
        if (detectInjection(page.text.slice(l.start, blockEnd)).flagged) continue
        const bodyStart = head ? ls.slice(i + 1).find((x) => x.text.trim())!.start : l.start + l.text.length - inline![1].length
        // Sentence units of the block; consecutive units are grouped into quotes of at most one quote length.
        const units = segs.filter((sg) => sg.start >= l.start && sg.end <= blockEnd)
        const groups: { a: number; z: number }[] = []
        for (const u of units) {
          const g = groups.at(-1)
          if (g && u.end - g.a <= MAX_QUOTE) g.z = u.end
          else if (u.end - u.start <= MAX_QUOTE) groups.push({ a: u.start, z: u.end })
        }
        groups.slice(0, 4).forEach((g, n) => {
          if (n === 0 && g.a > l.start) return // the heading itself did not fit with its first sentence: nothing to quote
          add('impression_documented', page, g.a, g.z, { section_text: page.text.slice(Math.max(g.a, bodyStart), g.z).replace(/\s+/g, ' ').trim() })
        })
        i = last
      }
    }

    // Regimen line as written ("Regimen: CAPOX ...", "Protocol: R-CHOP, every 21 days") when no cycle line already carries it
    for (const seg of clean) {
      const m = REGIMEN_PART.exec(seg.text)
      if (!m || chemoRegimenSegs.has(seg.start)) continue
      const rest = seg.text.slice(m.index + m[0].length)
      const cut = rest.search(/\t\s*[\p{Lu}][\p{L}\s/().-]{1,30}:/u)
      const value = (cut < 0 ? rest : rest.slice(0, cut)).replace(/\s+/g, ' ').trim()
      if (value.length < 2) continue
      add('regimen_documented', page, seg.start + m.index, seg.start + m.index + m[0].length + (cut < 0 ? rest.length : cut), { regimen_text: value })
    }

    // Lab result rows, grouped into quotes of consecutive rows: the values are shown as printed, never interpreted
    if (RESULT_DOCS.has(docType)) {
      let rows: { seg: Seg; name: string }[] = []
      const flush = () => {
        if (rows.length) {
          const text = page.text.slice(rows[0].seg.start, rows.at(-1)!.seg.end)
          add('lab_results_documented', page, rows[0].seg.start, rows.at(-1)!.seg.end, { test_names: [...new Set(rows.map((r) => r.name))], event_date_text: absDates(text)[0]?.raw })
        }
        rows = []
      }
      for (const seg of segs) {
        const m = seg.text.includes('\n') ? null : RESULT_ROW.exec(seg.text)
        if (!m) flush()
        else {
          if (rows.length && seg.end - rows[0].seg.start > MAX_QUOTE) flush()
          rows.push({ seg, name: m[1].trim() })
        }
      }
      flush()
    }

    // Printed prescription medication blocks
    if (docType === 'prescription_printed') {
      let block: { seg: Seg; name: string }[] = []
      const flush = () => {
        if (block.length) add('prescription_documented', page, block[0].seg.start, block[block.length - 1].seg.end, { medication_names: [...new Set(block.map((b) => b.name))] })
        block = []
      }
      for (const seg of segs) {
        const m = MED_LINE.exec(seg.text)
        const row = m ? null : MED_ROW.exec(seg.text)
        const name = m ? m[1] : row && !NOT_A_MEDICINE.test(row[1]) ? row[1] : null
        if (!name) flush()
        else {
          if (block.length && seg.end - block[0].seg.start > MAX_QUOTE) flush()
          block.push({ seg, name })
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
  // An addendum to a pathology report that reports an added test (IHC, molecular) documents that test, not a new report.
  const addedTest = docType === 'pathology_report' && first.text.split('\n').slice(0, HEADER_LINES).some((l) => ADDENDUM_TITLE.test(l)) &&
    pages.some((p) => ADDENDUM_TEST.test(p.text))
  const type = addedTest ? 'molecular_test_documented' : docEvent[docType]
  if (type) {
    const date: LabelledSpan | undefined = docType === 'lab_report' ? header.collectionDate ?? header.reportDate : header.reportDate
    const titleRe = TITLES[addedTest ? 'ihc_molecular_report' : docType]
    const tm = titleRe ? new RegExp(titleRe.source, titleRe.flags.replace('g', '')).exec(first.text) : null
    const title = tm && first.text.slice(0, tm.index).split('\n').length <= HEADER_LINES ? { value: tm[0], start: tm.index, end: tm.index + tm[0].length } : null
    if (date && type === 'consultation_documented') {
      // The consultation as the note names it: its title line, the visit date and, on the next line, who saw the patient.
      const lineStart = (at: number) => first.text.lastIndexOf('\n', at - 1) + 1
      const lineEnd = (at: number) => (first.text.indexOf('\n', at) + 1 || first.text.length + 1) - 1
      const s = title ? Math.min(lineStart(title.start), date.labelStart) : date.labelStart
      let e = Math.max(title ? lineEnd(title.end) : 0, date.end)
      const next = first.text.slice(lineEnd(date.end) + 1, lineEnd(lineEnd(date.end) + 1))
      if (SEEN_BY_INLINE.test(first.text.slice(date.end, lineEnd(date.end)))) e = Math.max(e, lineEnd(date.end)) // "Date: … <TAB> Seen by: Dr. …" on one line
      else if (SEEN_BY.test(next)) e = Math.max(e, lineEnd(lineEnd(date.end) + 1))
      const [qs, qe] = e - s <= MAX_QUOTE ? [s, e] : [date.labelStart, date.end]
      add(type, first, qs, qe, { event_date_text: date.value })
    } else if (date) {
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
  // A radiotherapy summary that never says "completed": its dose line is the course given.
  if (docType === 'radiotherapy_summary' && !out.some((c) => c.event_type === 'radiotherapy_documented')) {
    for (const page of pages) {
      for (const seg of segments(page)) {
        const m = RT_DOSE.exec(seg.text)
        if (m && !RT_NOT_DONE.test(seg.text) && !PROC_NOT_DONE.test(seg.text)) add('radiotherapy_documented', page, seg.start, seg.end, { treatment_text: m[0] })
      }
    }
  }
  return out
}
