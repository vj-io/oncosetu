// Banned-word lists (FR-RAD-04, FR-REQ-01, FR-CON-07, Appendix F) and the linter.
// Terms: plain word/phrase = whole-word match; trailing `*` = word prefix (e.g. `malignan*`).
// Matching is case-insensitive and Unicode-aware (works for Devanagari, where \b does not).

/** Radar wording and request letters (Appendix F): administrative wording only. */
export const RADAR_BANNED: readonly string[] = [
  'need', 'needs', 'needed', 'should', 'urgent', 'urgently', 'urgency', 'concerning', 'abnormal*',
  'progression', 'progressive', 'progressed', 'worse', 'worsening', 'worsened', 'risk', 'risks', 'risky',
  'recommend*',
  // Hindi equivalents
  'चाहिए', 'ज़रूरी', 'जरूरी', 'आवश्यक', 'तुरंत', 'फ़ौरन', 'चिंताजनक', 'असामान्य', 'बिगड़*', 'ख़तरा', 'खतरा', 'जोखिम',
  'सिफ़ारिश', 'सिफारिश',
]
export const LETTER_BANNED = RADAR_BANNED

/** Request letters / info sheets (FR-REQ-01): no legal-deadline or obligation claims. */
export const LEGAL_BANNED: readonly string[] = [
  'must', 'legally required to', 'within 72 hours you',
  'कानूनी रूप से बाध्य', '72 घंटे के भीतर आपको',
]

/** Diagnosis / staging / treatment-class words: banned on patient surfaces unless disclosure is cleared (FR-CON-07). */
export const DIAGNOSIS_WORDS: readonly string[] = [
  'cancer*', 'carcinoma*', 'malignan*', 'tumour*', 'tumor*', 'neoplas*', 'onco*', 'metasta*', 'chemo*',
  'radiotherapy', 'radiation', 'lymphoma*', 'leukemia*', 'leukaemia*', 'sarcoma*', 'myeloma*',
  'stage', 'stages', 'staging', 'staged', 'grade', 'grades', 'grading', 'palliative', 'biopsy', 'biopsies',
  'ihc', 'immunohistochemistry', 'histopatholog*', 'mastectomy', 'lumpectomy', 'hospice',
  // Hindi
  'कैंसर', 'कर्क रोग', 'कर्करोग', 'ट्यूमर', 'कीमो*', 'रेडियोथेरेपी', 'रेडिएशन', 'विकिरण', 'मेटास्टे*', 'बायोप्सी',
  'घातक', 'अर्बुद', 'रसौली', 'लिम्फोमा', 'ल्यूकेमिया', 'सारकोमा', 'मायलोमा', 'स्टेज', 'प्रशामक',
]

export type Ruleset = 'radar' | 'legal' | 'diagnosis'

const LISTS: Record<Ruleset, readonly string[]> = {
  radar: RADAR_BANNED,
  legal: LEGAL_BANNED,
  diagnosis: DIAGNOSIS_WORDS,
}

const WORD = '[\\p{L}\\p{M}\\p{N}_]'

function termRegex(term: string): RegExp {
  const prefix = term.endsWith('*')
  const body = (prefix ? term.slice(0, -1) : term)
    .normalize('NFC')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
  return new RegExp(`(?<!${WORD})${body}${prefix ? `${WORD}*` : ''}(?!${WORD})`, 'giu')
}

const COMPILED: Record<Ruleset, { term: string; re: RegExp }[]> = Object.fromEntries(
  (Object.keys(LISTS) as Ruleset[]).map((k) => [k, LISTS[k].map((term) => ({ term, re: termRegex(term) }))]),
) as Record<Ruleset, { term: string; re: RegExp }[]>

export interface LintHit {
  ruleset: Ruleset
  term: string
  match: string
  index: number
}

/** Returns every banned-term hit in `text` for the given rulesets (empty array = clean). */
export function lintText(text: string, rulesets: readonly Ruleset[]): LintHit[] {
  const hits: LintHit[] = []
  const nfc = text.normalize('NFC')
  for (const ruleset of rulesets) {
    for (const { term, re } of COMPILED[ruleset]) {
      re.lastIndex = 0
      for (const m of nfc.matchAll(re)) hits.push({ ruleset, term, match: m[0], index: m.index ?? 0 })
    }
  }
  return hits.sort((a, b) => a.index - b.index || a.term.localeCompare(b.term))
}
