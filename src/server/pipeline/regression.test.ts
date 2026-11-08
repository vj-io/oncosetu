// Automated evaluation guard (PRD §9.5): runs the rule-based evaluation on the TUNED set (public/demo-docs; the held-out
// set stays blind and is only run by hand: scripts/eval.ts) and fails if anything is worse than the numbers recorded in
// data/eval/report.json: an unsupported fact or an auto-extracted handwritten page, precision, recall, per-class recall,
// identity, classification macro-F1, or OCR character error rate on any printed image page. When a change improves a
// number, re-run scripts/eval.ts so report.json (and the coverage note staff see) records it.
import { describe, expect, it } from 'vitest'
import { readJson, runSet } from '../../../scripts/eval-set'
import { closeOcr } from './text'

type ClassRecall = Record<string, { recall: number | null; gold: number }>
type Report = {
  generatedAt: string; precision: number; recall: number; recallByClass: ClassRecall
  identity: { correct: number }; classification: { macroF1: number }
  ocr: { pages: { set: string; file: string; page: number; cer: number }[] }
}

describe('rule-based evaluation on the tuned set does not regress (data/eval/report.json)', () => {
  it('no unsupported fact; no number below the recorded run', async () => {
    const today = readJson<Report>('data/eval/report.json')
    // Same received date as the recorded run: late-received and future-date flags depend on it.
    const { summary, ocrPages } = await runSet('tuned', { llm: null, augmentRules: false, received: new Date(today.generatedAt), quiet: true })
    await closeOcr()
    expect(summary.gates).toEqual({ unsupportedFactsReachingRecord: 0, handwrittenAutoExtracted: 0, pass: true })
    expect(summary.precision).toBeGreaterThanOrEqual(today.precision)
    expect(summary.recall).toBeGreaterThanOrEqual(today.recall)
    for (const [cls, r] of Object.entries(today.recallByClass)) {
      if (r.recall !== null) expect(summary.recallByClass[cls]?.recall ?? 0, `recall for ${cls}`).toBeGreaterThanOrEqual(r.recall)
    }
    expect(summary.identity.correct).toBeGreaterThanOrEqual(today.identity.correct)
    expect(summary.classification.macroF1).toBeGreaterThanOrEqual(today.classification.macroF1)
    const before = today.ocr.pages.filter((p) => p.set === 'tuned')
    expect(ocrPages.length).toBe(before.length)
    for (const p of ocrPages) {
      const b = before.find((x) => x.file === p.file && x.page === p.page)!
      expect(p.cer, `CER ${p.file} p.${p.page}`).toBeLessThanOrEqual(b.cer + 1e-4)
    }
  }, 300_000)
})
