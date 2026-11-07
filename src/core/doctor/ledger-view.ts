// Small display rules for the "What's new" page. Pure.

export type SaidLike = { id: string; question: string; transcript: string; medicines: string[]; scans: string[]; institution: string | null }

// \b does not work for Devanagari, so the end of the word is "not followed by a letter or mark".
const PLAIN_NO = /^\s*(?:no|none|nothing|nope|nahi|nahin|नहीं|कुछ नहीं)(?![\p{L}\p{M}])[\s.!,]*$/iu
const NO_LIST = /^\s*(?:no|none|nothing|nope|nahi|nahin|नहीं|कुछ नहीं)(?![\p{L}\p{M}])/iu

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * Answers that are just "No" (and say nothing else) are folded into one line, e.g.
 * "No to: another hospital or doctor, new medicines." Everything with content stays as its own card.
 * The patient's other words are never shortened.
 */
export function mergeNoAnswers<T extends SaidLike>(items: readonly T[]): { noLine: string | null; rest: T[] } {
  const plain = items.filter((s) => (PLAIN_NO.test(s.transcript) || (NO_LIST.test(s.transcript) && s.transcript.length <= 12)) && !s.medicines.length && !s.scans.length && !s.institution)
  if (plain.length < 2) return { noLine: null, rest: [...items] }
  const ids = new Set(plain.map((s) => s.id))
  return { noLine: `No to: ${plain.map((s) => lower(s.question)).join(', ')}.`, rest: items.filter((s) => !ids.has(s.id)) }
}
