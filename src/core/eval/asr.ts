// Speech-recognition scoring for scripts/eval-asr.ts (FR-VOX-03). Pure, no I/O.

/** Lower case, NFC, no punctuation or Devanagari nukta/danda, single spaces: spelling differences in case and marks don't count. */
export const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\u093c/g, '').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/** Word-level edit distance / reference word count. */
export function wer(hyp: string, ref: string): number {
  const h = norm(hyp).split(' ').filter(Boolean), r = norm(ref).split(' ').filter(Boolean)
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j)
  for (let i = 1; i <= r.length; i++) {
    const cur = [i]
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[h.length] / r.length
}
/** The drug name, every word of it in order, appears in the transcript. */
export const heard = (hyp: string, drug: string) => ` ${norm(hyp)} `.includes(` ${norm(drug)} `)
