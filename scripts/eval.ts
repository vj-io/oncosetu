/**
 * Offline pipeline evaluation (PRD §9.5, adapted to the synthetic sets). Runs the SAME pure pipeline functions as
 * the server (src/server/pipeline/text.ts + core.ts) over the document sets in scripts/eval-set.ts and compares against
 * hand-authored gold:
 *   tuned    20 documents in public/demo-docs (gold: data/eval/gold.json). The rule library was tuned on these: optimistic.
 *   heldout  40 documents in data/eval/heldout (gold: data/eval/gold-heldout.json), written after the rules were frozen.
 *   redteam  28 adversarial documents in data/eval/redteam (only with --set redteam; the 2 injection documents of the
 *            sets above make the 30 of PRD §9.5).
 * It writes data/eval/report.json (rules) or report-llm.json (--llm); report.json is read by the source viewer's coverage note.
 * Also measures OCR character error rate (FR-DOC-02) on every printed image page of the sets that run, against the
 * ground-truth text the generators write (data/eval/ocr-truth.json, data/eval/heldout/ocr-truth.json).
 *
 *   npx tsx --env-file=.env.local scripts/eval.ts                    # rule-based path (no LLM), tuned + held-out
 *   npx tsx --env-file=.env.local scripts/eval.ts --set heldout      # tuned | heldout | redteam | all (default all); a partial run writes report[-llm]-<set>.json
 *   npx tsx --env-file=.env.local scripts/eval.ts --llm              # LLM path, if a provider is configured
 *
 * Exit code 1 when a hard gate fails in any set that ran: an unsupported fact reached the record, or a handwritten page was auto-extracted.
 * The rule-based numbers are guarded automatically: src/server/pipeline/regression.test.ts (tuned set) and redteam.test.ts.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { llmExtractor, type AiRunRecord } from '../src/server/ai/extract'
import { reserveLlmCallWaiting, settleLlmCall } from '../src/server/ai/quota'
import { llmProvider } from '../src/server/ai/provider'
import { closeOcr } from '../src/server/pipeline/text'
import { meanOf, ROOT, runSet, SETS, type SetName } from './eval-set'

const setAt = process.argv.findIndex((a) => a === '--set' || a.startsWith('--set='))
const setChoice = setAt < 0 ? 'all' : process.argv[setAt].startsWith('--set=') ? process.argv[setAt].slice(6) : process.argv[setAt + 1]
if (setChoice !== 'all' && !(setChoice in SETS)) throw new Error(`--set must be tuned, heldout, redteam or all (got ${setChoice})`)
const setsToRun: SetName[] = setChoice === 'all' ? ['tuned', 'heldout'] : [setChoice as SetName]

const useLlm = process.argv.includes('--llm')
const provider = useLlm ? llmProvider() : null
if (useLlm && !provider) console.warn('--llm given but no provider is configured: running the rule-based path')
const runs: AiRunRecord[] = []
const RECEIVED = new Date()

async function main() {
  const llm = provider ? llmExtractor(provider, runs, provider.provider === 'google' ? { reserve: reserveLlmCallWaiting, settle: settleLlmCall } : null) : null
  const results = {} as Record<SetName, Awaited<ReturnType<typeof runSet>>>
  for (const name of setsToRun) results[name] = await runSet(name, { llm, augmentRules: provider?.provider === 'google', received: RECEIVED })
  await closeOcr()

  const pages = setsToRun.flatMap((n) => results[n].ocrPages)
  const ocr = {
    note: 'CER = Levenshtein(normalised OCR text, normalised ground truth) / length(truth), per printed image page of the sets that ran; whitespace is the only normalisation (case and punctuation count). Truth = the text the generator drew on the page (data/eval/ocr-truth.json, data/eval/heldout/ocr-truth.json). Handwritten pages are excluded; `devanagari` = the page contains Devanagari text. PRD FR-DOC-02: CER <= 5% on a printed-report eval set.',
    prdThreshold: 0.05,
    cer: meanOf(pages.map((p) => p.cer)),
    maxCer: pages.length ? Math.max(...pages.map((p) => p.cer)) : null,
    pagesScored: pages.length,
    excludedHandwritten: setsToRun.reduce((a, n) => a + results[n].excludedHandwritten, 0),
    cerLatin: meanOf(pages.filter((p) => p.script === 'latin').map((p) => p.cer)),
    cerDevanagari: meanOf(pages.filter((p) => p.script === 'devanagari').map((p) => p.cer)),
    pages,
  }

  const t = results.tuned?.summary
  const report = {
    generatedAt: new Date().toISOString(),
    method: provider ? `llm:${provider.modelId}` : 'rules',
    note: 'Precision counts an extracted event correct when it matches at least one gold fact (type, date, text); recall counts gold facts found. Held documents (identity not matched) are scored on what would be extracted after a person attaches them; nothing from them reaches the record. Top-level numbers are the TUNED set (the rule library was tuned on it: optimistic); `heldout` was written after the rules were frozen.',
    ...t, // dataset, gates, precision, recall, counts, recallByClass, precisionByClass, identity, classification, injection, docs: the tuned set, top level as before
    aiRuns: runs.map((r) => ({ outcome: r.outcome, latencyMs: r.latencyMs, tokensIn: r.tokensIn, tokensOut: r.tokensOut })),
    ...(results.heldout && { heldout: results.heldout.summary }),
    ...(results.redteam && { redteam: results.redteam.summary }),
    ocr,
  }
  // The coverage note reads report.json, so only a full rule-path run may write it; partial runs get their own file.
  const out = `data/eval/report${provider ? '-llm' : ''}${setChoice === 'all' ? '' : '-' + setChoice}.json`
  writeFileSync(join(ROOT, out), JSON.stringify(report, null, 2) + '\n')

  console.log(`\nOCR CER (${pages.length} printed image pages): mean ${ocr.cer}  max ${ocr.maxCer}  latin ${ocr.cerLatin}  devanagari ${ocr.cerDevanagari}   -> ${out}`)
  const failed = setsToRun.filter((n) => !results[n].summary.gates.pass)
  if (failed.length) {
    console.error(`HARD GATE FAILED in: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
