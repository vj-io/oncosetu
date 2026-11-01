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
]

/** Scans text for prompt-injection phrasing. */
export function detectInjection(text: string): InjectionResult {
  const hits: InjectionHit[] = []
  for (const [pattern, re] of PATTERNS) {
    for (const m of text.matchAll(re)) hits.push({ pattern, raw: m[0], start: m.index!, end: m.index! + m[0].length })
  }
  hits.sort((a, b) => a.start - b.start || a.pattern.localeCompare(b.pattern))
  return { flagged: hits.length > 0, flags: hits.length ? ['prompt_injection_suspected'] : [], hits }
}
