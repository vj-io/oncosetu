// Detects instruction-like / injected text in a document (§9.6, E-DOC-16). Flags only; never alters text.

export interface InjectionHit {
  pattern: string
  raw: string
  start: number
  end: number
}
export interface InjectionResult {
  flagged: boolean
  flags: 'prompt_injection_suspected'[]
  hits: InjectionHit[]
}

const PATTERNS: [string, RegExp][] = [
  ['ignore_instructions', /\b(?:ignore|disregard|forget|override|bypass|skip)\s+(?:all\s+|any\s+|the\s+|your\s+|these\s+|my\s+)*(?:previous|prior|above|earlier|preceding|system|original|safety)?\s*(?:instructions?|prompts?|rules?|guidelines?|directions?|context)\b/giu],
  ['mark_verified', /\b(?:mark|set|flag)\s+(?:this|it|all|the|these|everything|each|every)?\s*(?:\w+\s+){0,4}?(?:as\s+)?(?:verified|approved|confirmed|reviewed|validated|matched|signed[\s-]off)\b/giu],
  ['status_change', /\b(?:change|update|set)\s+(?:the\s+)?(?:verification\s+)?status\s+to\b/giu],
  ['system_prompt', /\bsystem\s*prompt\b|<\/?\s*(?:system|assistant|user|instructions?)\s*>|\[\s*(?:system|inst)\s*\]/giu],
  ['role_address', /\byou\s+are\s+(?:now\s+)?(?:an?\s+|the\s+)?(?:ai|assistant|language\s+model|llm|chatbot|gpt|claude|model)\b|\bas\s+an\s+ai\b/giu],
  ['role_marker', /^\s*(?:system|assistant)\s*:/gimu],
  ['new_instructions', /\b(?:new|updated|real|actual|hidden)\s+instructions?\b|\bdeveloper\s+mode\b|\bjailbreak\b|\bdo\s+anything\s+now\b/giu],
  ['suppress_output', /\bdo\s+not\s+(?:extract|report|mention|include|flag|show|record|output)\b/giu],
  ['act_as', /\b(?:act|behave|respond|pretend)\s+as\s+(?:if\s+)?(?:an?\s+|the\s+)?(?:ai|assistant|admin|administrator|doctor|clinician|system)\b/giu],
  ['hi_ignore', /(?:पिछले|पहले\s+के|सभी)\s+(?:निर्देशों|निर्देश)\s+(?:को\s+)?(?:अनदेखा|नज़रअंदाज़|नजरअंदाज|भूल)/gu],
  ['hi_mark_verified', /(?:सत्यापित|वेरिफाइड|प्रमाणित)\s+(?:के\s+रूप\s+में\s+)?(?:चिह्नित|मार्क)\s+करें/gu],
  // An instruction to put a judgement into the record ("add the diagnosis ...", "update the stage to IV").
  ['add_fact', /\b(?:add|insert|record|enter|write|update|change|set)\s+(?:the\s+|a\s+|this\s+|an\s+)?(?:diagnosis|stage|grade|risk(?:\s+score)?|prognosis)\s+(?:as|to|of|=|:|["“'])/giu],
  // A line telling the reader to disbelieve the document ("the true date of this report is ...", "the real diagnosis is ...").
  ['override_claim', /\b(?:the\s+)?(?:real|true|actual|correct)\s+(?:date|diagnosis|patient|name|result)\s+(?:of\s+this\s+(?:report|document|patient)\s+)?is\b/giu],
]

// Look-alike letters (Cyrillic, Greek) that pass for Latin in "Ignоre previous instructions" (PRD §9.5 red-team set).
const CONFUSABLE: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', ԛ: 'q', ԝ: 'w',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', І: 'I', Ј: 'J', Ѕ: 'S',
  α: 'a', ο: 'o', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ρ: 'p', τ: 't', υ: 'u', Α: 'A', Β: 'B', Ε: 'E', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Χ: 'X',
}

/** Text as a reader sees it: compatibility forms (fullwidth letters) folded, invisible format characters removed, look-alikes mapped to Latin. */
export function foldForInjection(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[^\x00-\x7F]/g, (ch) => CONFUSABLE[ch] ?? ch)
}

function scan(text: string): InjectionHit[] {
  const hits: InjectionHit[] = []
  for (const [pattern, re] of PATTERNS) {
    for (const m of text.matchAll(re)) hits.push({ pattern, raw: m[0], start: m.index!, end: m.index! + m[0].length })
  }
  return hits
}

/**
 * Scans text for prompt-injection phrasing, as written and as folded (unicode tricks: look-alike letters, zero-width
 * and direction characters, soft hyphens, fullwidth forms). Hits found only in the folded text carry offsets into it.
 */
export function detectInjection(text: string): InjectionResult {
  const hits = scan(text)
  const folded = foldForInjection(text)
  if (folded !== text) for (const h of scan(folded)) if (!hits.some((x) => x.pattern === h.pattern)) hits.push(h)
  hits.sort((a, b) => a.start - b.start || a.pattern.localeCompare(b.pattern))
  return { flagged: hits.length > 0, flags: hits.length ? ['prompt_injection_suspected'] : [], hits }
}
