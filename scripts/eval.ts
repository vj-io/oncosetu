/**
 * Offline pipeline evaluation (PRD §9.5, adapted to the synthetic sets). Runs the SAME pure pipeline functions as
 * the server (src/server/pipeline/text.ts + core.ts) over two document sets and compares against hand-authored gold:
 *   tuned    20 documents in public/demo-docs (gold: data/eval/gold.json). The rule library was tuned on these: optimistic.
 *   heldout  40 documents in data/eval/heldout (gold: data/eval/gold-heldout.json), written after the rules were frozen.
 * It writes data/eval/report.json (rules) or report-llm.json (--llm); report.json is read by the source viewer's coverage note.
 * Also measures OCR character error rate (FR-DOC-02) on every printed image page of the sets that run, against the
 * ground-truth text the generators write (data/eval/ocr-truth.json, data/eval/heldout/ocr-truth.json).
 *
 *   npx tsx --env-file=.env.local scripts/eval.ts                    # rule-based path (no LLM), both sets
 *   npx tsx --env-file=.env.local scripts/eval.ts --set heldout      # tuned | heldout | all (default all); a partial run writes report[-llm]-<set>.json
 *   npx tsx --env-file=.env.local scripts/eval.ts --llm              # LLM path, if a provider is configured
 *
 * Exit code 1 when a hard gate fails in any set that ran: an unsupported fact reached the record, or a handwritten page was auto-extracted.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { cer as cerOf, macroF1 } from '../src/core/eval/metrics'
import { normalise } from '../src/core/gate'
import { DOC_TYPES } from '../src/core/types'
import { llmExtractor, type AiRunRecord } from '../src/server/ai/extract'
import { reserveLlmCallWaiting, settleLlmCall } from '../src/server/ai/quota'
import { llmProvider } from '../src/server/ai/provider'
import { analyse, type DraftEvent } from '../src/server/pipeline/core'
import { sniffMime } from '../src/server/pipeline/safety'
import { closeOcr, readPages, type PageRead } from '../src/server/pipeline/text'

const ROOT = resolve(dirname(process.argv[1] ?? '.'), '..')
type GoldEvent = { type: string; date?: string; match?: string }
type GoldDoc = { patientKey: string; docType: string; identity: string; handwritten?: boolean; held?: boolean; injection?: boolean; addendum?: boolean; forbidden?: string[]; events: GoldEvent[] }
type Patient = { patientKey: string; fullName: string; aliases: string[]; dob: string; sex: string }
type OcrTruth = Record<string, Record<string, { handwritten: boolean; text: string }>>

const SETS = {
  tuned: { dir: 'public/demo-docs', gold: 'data/eval/gold.json', truth: 'data/eval/ocr-truth.json' },
  heldout: { dir: 'data/eval/heldout', gold: 'data/eval/gold-heldout.json', truth: 'data/eval/heldout/ocr-truth.json' },
} as const
type SetName = keyof typeof SETS

const setAt = process.argv.findIndex((a) => a === '--set' || a.startsWith('--set='))
const setChoice = setAt < 0 ? 'all' : process.argv[setAt].startsWith('--set=') ? process.argv[setAt].slice(6) : process.argv[setAt + 1]
if (setChoice !== 'all' && setChoice !== 'tuned' && setChoice !== 'heldout') throw new Error(`--set must be tuned, heldout or all (got ${setChoice})`)
const setsToRun: SetName[] = setChoice === 'all' ? ['tuned', 'heldout'] : [setChoice]

const useLlm = process.argv.includes('--llm')
const provider = useLlm ? llmProvider() : null
if (useLlm && !provider) console.warn('--llm given but no provider is configured: running the rule-based path')
const runs: AiRunRecord[] = []
const RECEIVED = new Date()

const lc = (s: string) => s.toLowerCase()
const readJson = <T>(rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T
const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null)
const r4 = (x: number) => Math.round(x * 10000) / 10000
function matches(g: GoldEvent, d: DraftEvent): boolean {
  if (g.type !== d.eventType) return false
  if (g.date && d.eventDate !== g.date) return false
  if (g.match) {
    const hay = lc(d.evidence.quote + ' ' + JSON.stringify(d.fields))
    if (!hay.includes(lc(g.match))) return false
  }
  return true
}

/** Independent re-check of what the gate promises (does not call the gate): exact slice + every value in quote/header. */
function unsupported(d: DraftEvent, pages: PageRead[]): string | null {
  const page = pages.find((p) => p.pageNo === d.evidence.pageNo)
  if (!page) return 'page_missing'
  if (page.text.slice(d.evidence.charStart, d.evidence.charEnd) !== d.evidence.quote) return 'quote_not_exact_slice'
  const q = normalise(d.evidence.quote + (d.evidence.continuation ? ' ' + d.evidence.continuation.quote : ''))
  const head = normalise([page, pages[0]].map((p) => p.text.split('\n').slice(0, 15).join('\n')).join('\n'))
  for (const [k, v] of Object.entries(d.fields)) {
    for (const x of Array.isArray(v) ? v : [v]) {
      const s = normalise(String(x))
      if (!s) continue
      if (!q.includes(s) && !(['institution_name', 'test_name', 'test_names'].includes(k) && head.includes(s))) return `field_not_supported:${k}`
    }
  }
  if (d.eventDate && !d.flags.date_from_document && !/\d/.test(d.evidence.quote)) return 'date_not_in_quote'
  for (const p of pages) if (p.hidden && normalise(p.hidden).includes(q)) return 'quote_from_hidden_text'
  return null
}

type Row = Record<string, unknown>
type OcrPage = { set: SetName; file: string; page: number; script: 'latin' | 'devanagari'; cer: number; truthChars: number; ocrChars: number; ocrConfidence: number | null }

async function runSet(name: SetName) {
  const spec = SETS[name]
  const DOCS = join(ROOT, spec.dir)
  const gold = readJson<{ docs: Record<string, GoldDoc> }>(spec.gold)
  const patients = readJson<Patient[]>(join(spec.dir, 'patients.json'))
  const truth = readJson<OcrTruth>(spec.truth)
  const perDoc: Row[] = []
  const byClass: Record<string, { gold: number; found: number; pred: number; correct: number }> = {}
  let unsupportedInRecord = 0
  let handwrittenAuto = 0
  let identityCorrect = 0
  let typeCorrect = 0
  const injectionRows: Row[] = []
  const ocrPages: OcrPage[] = []
  let excludedHandwritten = 0
  const typePairs: { expected: string; got: string }[] = []

  console.log(`\n== ${name}: ${spec.dir} ==`)
  const files = Object.keys(gold.docs).sort()
  for (const file of files) {
    const g = gold.docs[file]
    const p = patients.find((x) => x.patientKey === g.patientKey)!
    const bytes = new Uint8Array(readFileSync(join(DOCS, file)))
    const mime = sniffMime(bytes)!
    const t0 = Date.now()
    const read = await readPages(bytes, mime)
    if (read.kind !== 'pages') {
      perDoc.push({ file, error: read.kind })
      continue
    }
    const a = await analyse(read.pages, { name: p.fullName, aliases: p.aliases, dob: p.dob, sex: p.sex }, RECEIVED, provider ? llmExtractor(provider, runs, provider.provider === 'google' ? { reserve: reserveLlmCallWaiting, settle: settleLlmCall } : null) : null, { augmentRules: provider?.provider === 'google', attached: g.identity === 'match' }) // held but truly this patient's: a person attaches it, then it is extracted like any other
    const reachesRecord = a.identified.identity.result === 'match'
    const recordDrafts = reachesRecord ? a.drafts : []
    const problems = recordDrafts.map((d) => ({ d, why: unsupported(d, read.pages) })).filter((x) => x.why)
    unsupportedInRecord += problems.length
    if (g.handwritten) handwrittenAuto += a.drafts.length

    // OCR character error rate: every printed image page (handwritten pages are excluded by the generator's flag)
    if (mime.startsWith('image/')) {
      for (const pg of read.pages) {
        const tr = truth[file]?.[String(pg.pageNo)]
        if (!tr) throw new Error(`${file} page ${pg.pageNo}: no ground-truth text in ${spec.truth} (run the generator)`)
        if (tr.handwritten) {
          excludedHandwritten++
          continue
        }
        ocrPages.push({
          set: name, file, page: pg.pageNo, script: /[ऀ-ॿ]/.test(tr.text) ? 'devanagari' : 'latin', cer: r4(cerOf(pg.text, tr.text)),
          truthChars: tr.text.replace(/\s+/g, ' ').trim().length, ocrChars: pg.text.replace(/\s+/g, ' ').trim().length, ocrConfidence: pg.ocrConfidence === null ? null : r4(pg.ocrConfidence),
        })
      }
    }

    // Extraction quality is measured on the drafts (what the record gets once identity is settled), held docs included.
    const goldHit = g.events.map((ge) => a.drafts.some((d) => matches(ge, d)))
    const predOk = a.drafts.map((d) => g.events.some((ge) => matches(ge, d)))
    const c = (byClass[g.docType] ??= { gold: 0, found: 0, pred: 0, correct: 0 })
    c.gold += g.events.length
    c.found += goldHit.filter(Boolean).length
    c.pred += a.drafts.length
    c.correct += predOk.filter(Boolean).length
    if (a.identified.identity.result === g.identity) identityCorrect++
    if (a.classified.docType === g.docType) typeCorrect++
    typePairs.push({ expected: g.docType, got: a.classified.docType })
    if (g.injection || a.injection.flagged) {
      const forbidden = (g.forbidden ?? []).filter((f) => a.drafts.some((d) => lc(d.evidence.quote + JSON.stringify(d.fields)).includes(lc(f))))
      injectionRows.push({
        file, expected: !!g.injection, flagged: a.injection.flagged, patterns: a.injection.patterns, hiddenChars: a.injection.hiddenChars,
        forbiddenInDrafts: forbidden, forbiddenFieldRejections: a.gate.rejected.filter((r) => r.reason === 'forbidden_field').length,
      })
    }
    perDoc.push({
      file, docType: { expected: g.docType, got: a.classified.docType }, identity: { expected: g.identity, got: a.identified.identity.result, reasons: a.identified.identity.reasons },
      handwritten: a.classified.handwritten, method: a.method, ms: Date.now() - t0, reachesRecord,
      gold: g.events.length, found: goldHit.filter(Boolean).length, extracted: a.drafts.length, correct: predOk.filter(Boolean).length,
      missed: g.events.filter((_, i) => !goldHit[i]),
      extra: a.drafts.filter((_, i) => !predOk[i]).map((d) => ({ type: d.eventType, date: d.eventDate, quote: d.evidence.quote.slice(0, 90) })),
      gateRejected: a.gate.rejected.length, unsupported: problems.map((x) => x.why),
    })
    console.log(`${file.padEnd(54)} id=${a.identified.identity.result.padEnd(12)} type=${a.classified.docType.padEnd(22)} found ${goldHit.filter(Boolean).length}/${g.events.length}  correct ${predOk.filter(Boolean).length}/${a.drafts.length}`)
  }

  const tot = Object.values(byClass).reduce((a, c) => ({ gold: a.gold + c.gold, found: a.found + c.found, pred: a.pred + c.pred, correct: a.correct + c.correct }), { gold: 0, found: 0, pred: 0, correct: 0 })
  const mf = macroF1(typePairs)
  const summary = {
    dataset: `${files.length} synthetic documents in ${spec.dir} (gold: ${spec.gold})`,
    gates: {
      unsupportedFactsReachingRecord: unsupportedInRecord,
      handwrittenAutoExtracted: handwrittenAuto,
      pass: unsupportedInRecord === 0 && handwrittenAuto === 0,
    },
    precision: ratio(tot.correct, tot.pred),
    recall: ratio(tot.found, tot.gold),
    counts: tot,
    recallByClass: Object.fromEntries(DOC_TYPES.filter((t) => byClass[t]).map((t) => [t, { recall: ratio(byClass[t].found, byClass[t].gold), gold: byClass[t].gold }])),
    precisionByClass: Object.fromEntries(DOC_TYPES.filter((t) => byClass[t]).map((t) => [t, { precision: ratio(byClass[t].correct, byClass[t].pred), extracted: byClass[t].pred }])),
    identity: { correct: identityCorrect, total: files.length, accuracy: ratio(identityCorrect, files.length) },
    classification: {
      correct: typeCorrect, total: files.length, accuracy: ratio(typeCorrect, files.length), macroF1: ratio(Math.round(mf.macroF1 * 1e6), 1e6),
      perClass: Object.fromEntries(Object.entries(mf.perClass).map(([c, s]) => [c, { precision: s.precision === null ? null : ratio(Math.round(s.precision * 1e6), 1e6), recall: s.recall === null ? null : ratio(Math.round(s.recall * 1e6), 1e6), f1: ratio(Math.round(s.f1 * 1e6), 1e6), support: s.support, predicted: s.predicted }])),
    },
    injection: injectionRows,
    docs: perDoc,
  }
  console.log(`precision ${summary.precision}  recall ${summary.recall}  identity ${identityCorrect}/${files.length}  type ${typeCorrect}/${files.length}  macro-F1 ${summary.classification.macroF1}`)
  console.log(`unsupported facts reaching record: ${unsupportedInRecord}   handwritten auto-extracted: ${handwrittenAuto}`)
  console.log('recall by class:', JSON.stringify(summary.recallByClass))
  return { summary, ocrPages, excludedHandwritten }
}

async function main() {
  const results = {} as Record<SetName, Awaited<ReturnType<typeof runSet>>>
  for (const name of setsToRun) results[name] = await runSet(name)
  await closeOcr()

  const pages = setsToRun.flatMap((n) => results[n].ocrPages)
  const mean = (xs: number[]) => (xs.length ? r4(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  const ocr = {
    note: 'CER = Levenshtein(normalised OCR text, normalised ground truth) / length(truth), per printed image page of the sets that ran; whitespace is the only normalisation (case and punctuation count). Truth = the text the generator drew on the page (data/eval/ocr-truth.json, data/eval/heldout/ocr-truth.json). Handwritten pages are excluded; `devanagari` = the page contains Devanagari text. PRD FR-DOC-02: CER <= 5% on a printed-report eval set.',
    prdThreshold: 0.05,
    cer: mean(pages.map((p) => p.cer)),
    maxCer: pages.length ? Math.max(...pages.map((p) => p.cer)) : null,
    pagesScored: pages.length,
    excludedHandwritten: setsToRun.reduce((a, n) => a + results[n].excludedHandwritten, 0),
    cerLatin: mean(pages.filter((p) => p.script === 'latin').map((p) => p.cer)),
    cerDevanagari: mean(pages.filter((p) => p.script === 'devanagari').map((p) => p.cer)),
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
