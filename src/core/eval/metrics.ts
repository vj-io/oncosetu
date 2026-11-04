// Evaluation metrics for scripts/eval.ts (PRD §9.5, FR-DOC-02, FR-DOC-04). Pure, no I/O.

/** Whitespace is the only normalisation: runs of whitespace collapse to one space, ends trimmed. Case and punctuation count. */
export const normaliseOcr = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Edit distance over code points (insert, delete, substitute = 1 each). Two-row DP. */
export function levenshtein(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  if (!x.length) return y.length
  if (!y.length) return x.length
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const cur = [i]
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[y.length]
}

/** Character error rate = Levenshtein(normalised OCR, normalised truth) / length(normalised truth). Not capped: an OCR much longer than the truth exceeds 1. */
export function cer(ocr: string, truth: string): number {
  const t = normaliseOcr(truth)
  if (!t) throw new Error('cer: ground-truth text is empty')
  return levenshtein(normaliseOcr(ocr), t) / Array.from(t).length
}

export type ClassScore = { precision: number | null; recall: number | null; f1: number; support: number; predicted: number }

/**
 * Macro-F1 over the classes that appear as an expected OR a predicted label (sklearn's default). A class that is predicted
 * but has no expected document scores F1 = 0, so spurious predictions cost; classes in neither list are not counted.
 */
export function macroF1(pairs: { expected: string; got: string }[]): { macroF1: number; perClass: Record<string, ClassScore> } {
  const labels = [...new Set(pairs.flatMap((p) => [p.expected, p.got]))]
  const perClass: Record<string, ClassScore> = {}
  for (const c of labels) {
    const tp = pairs.filter((p) => p.expected === c && p.got === c).length
    const support = pairs.filter((p) => p.expected === c).length
    const predicted = pairs.filter((p) => p.got === c).length
    perClass[c] = { precision: predicted ? tp / predicted : null, recall: support ? tp / support : null, f1: (2 * tp) / (support + predicted), support, predicted }
  }
  const f1s = labels.map((c) => perClass[c].f1)
  return { macroF1: f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : 0, perClass }
}
