/**
 * One evaluation set run through the SAME pure pipeline functions as the server (src/server/pipeline/text.ts + core.ts),
 * scored against hand-authored gold. Used by scripts/eval.ts (the CLI that writes data/eval/report*.json) and by the
 * automated guards (src/server/pipeline/regression.test.ts, the red-team test), which run the rule-based path only.
 *   tuned    20 documents in public/demo-docs (gold: data/eval/gold.json). The rule library was tuned on these: optimistic.
 *   heldout  40 documents in data/eval/heldout (gold: data/eval/gold-heldout.json), written after the rules were frozen.
 *   redteam  28 adversarial documents in data/eval/redteam (gold: data/eval/gold-redteam.json): prompt injection, hidden
 *            and tiny text, fake diagnoses, wrong-patient headers, unicode tricks, conflicting dates (PRD §9.5).
 *   heldout2 24 documents in data/eval/heldout2, written 9 Nov 2026 by a separate author who did not see the rules; blind.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cer as cerOf, macroF1 } from '../src/core/eval/metrics'
import { normalise } from '../src/core/gate'
import { DOC_TYPES } from '../src/core/types'
import { analyse, type DraftEvent, type LlmExtractor } from '../src/server/pipeline/core'
import { sniffFile } from '../src/server/pipeline/filetypes'
import { readPages, type PageRead } from '../src/server/pipeline/text'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
type GoldEvent = { type: string; date?: string; match?: string }
export type GoldDoc = { patientKey: string; docType: string; identity: string; handwritten?: boolean; held?: boolean; injection?: boolean; addendum?: boolean; forbidden?: string[]; events: GoldEvent[] }
type Patient = { patientKey: string; fullName: string; aliases: string[]; dob: string; sex: string }
type OcrTruth = Record<string, Record<string, { handwritten: boolean; text: string }>>

/** Event types added in November 2026 (oncology lines). The held-out rules for these were tuned using some of the held-out documents. */
const ONCOLOGY_TYPES = new Set(['stage_documented', 'marker_results_documented', 'margins_documented', 'impression_documented', 'addendum_documented', 'regimen_documented'])

export const SETS = {
  tuned: { dir: 'public/demo-docs', gold: 'data/eval/gold.json', truth: 'data/eval/ocr-truth.json' },
  heldout: { dir: 'data/eval/heldout', gold: 'data/eval/gold-heldout.json', truth: 'data/eval/heldout/ocr-truth.json' },
  redteam: { dir: 'data/eval/redteam', gold: 'data/eval/gold-redteam.json', truth: 'data/eval/redteam/ocr-truth.json' },
  heldout2: { dir: 'data/eval/heldout2', gold: 'data/eval/gold-heldout2.json', truth: 'data/eval/heldout2/ocr-truth.json' },
} as const
export type SetName = keyof typeof SETS

const lc = (s: string) => s.toLowerCase()
export const readJson = <T>(rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T
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
export function unsupported(d: DraftEvent, pages: PageRead[]): string | null {
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
export type OcrPage = { set: SetName; file: string; page: number; script: 'latin' | 'devanagari'; cer: number; truthChars: number; ocrChars: number; ocrConfidence: number | null }
export type RunOptions = { llm: LlmExtractor | null; augmentRules: boolean; received: Date; quiet?: boolean }

export async function runSet(name: SetName, opts: RunOptions) {
  const log = opts.quiet ? () => {} : console.log
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

  log(`\n== ${name}: ${spec.dir} ==`)
  const files = Object.keys(gold.docs).sort()
  // Only event types this set's gold labels at all are scored; the rest (types added after the gold was written) are
  // counted, still pass the hard gates, and are scored once someone labels them.
  const scoredTypes = new Set(Object.values(gold.docs).flatMap((d) => d.events.map((e) => e.type)))
  const unscored: Record<string, number> = {}
  const old = { gold: 0, found: 0, pred: 0, correct: 0 } // the labels as they were before the oncology types: no new type counted on either side
  for (const file of files) {
    const g = gold.docs[file]
    const p = patients.find((x) => x.patientKey === g.patientKey)!
    const bytes = new Uint8Array(readFileSync(join(DOCS, file)))
    const mime = sniffFile(bytes, file)!.mime
    const t0 = Date.now()
    const read = await readPages(bytes, mime)
    if (read.kind !== 'pages') {
      perDoc.push({ file, error: read.kind })
      continue
    }
    const a = await analyse(read.pages, { name: p.fullName, aliases: p.aliases, dob: p.dob, sex: p.sex }, opts.received, opts.llm, { augmentRules: opts.augmentRules, attached: g.identity === 'match' }) // held but truly this patient's: a person attaches it, then it is extracted like any other
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
    for (const d of a.drafts) if (!scoredTypes.has(d.eventType)) unscored[d.eventType] = (unscored[d.eventType] ?? 0) + 1
    const drafts = a.drafts.filter((d) => scoredTypes.has(d.eventType))
    const goldHit = g.events.map((ge) => drafts.some((d) => matches(ge, d)))
    const predOk = drafts.map((d) => g.events.some((ge) => matches(ge, d)))
    const c = (byClass[g.docType] ??= { gold: 0, found: 0, pred: 0, correct: 0 })
    const oldGold = g.events.filter((e) => !ONCOLOGY_TYPES.has(e.type))
    const oldDrafts = drafts.filter((d) => !ONCOLOGY_TYPES.has(d.eventType))
    old.gold += oldGold.length
    old.found += oldGold.filter((ge) => oldDrafts.some((d) => matches(ge, d))).length
    old.pred += oldDrafts.length
    old.correct += oldDrafts.filter((d) => oldGold.some((ge) => matches(ge, d))).length
    c.gold += g.events.length
    c.found += goldHit.filter(Boolean).length
    c.pred += drafts.length
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
      gold: g.events.length, found: goldHit.filter(Boolean).length, extracted: drafts.length, correct: predOk.filter(Boolean).length,
      missed: g.events.filter((_, i) => !goldHit[i]),
      extra: drafts.filter((_, i) => !predOk[i]).map((d) => ({ type: d.eventType, date: d.eventDate, quote: d.evidence.quote.slice(0, 90) })),
      gateRejected: a.gate.rejected.length, unsupported: problems.map((x) => x.why),
    })
    log(`${file.padEnd(54)} id=${a.identified.identity.result.padEnd(12)} type=${a.classified.docType.padEnd(22)} found ${goldHit.filter(Boolean).length}/${g.events.length}  correct ${predOk.filter(Boolean).length}/${drafts.length}`)
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
    // Reported separately on purpose: precision and recall on the labels that existed before the oncology types were added.
    // For the held-out set these are the untouched labels; the main numbers above include the new types, whose rules were tuned using some held-out documents.
    untouchedLabels: { precision: ratio(old.correct, old.pred), recall: ratio(old.found, old.gold), counts: old, excludesTypes: [...ONCOLOGY_TYPES] },
    unscoredTypes: unscored,
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
  log(`precision ${summary.precision}  recall ${summary.recall}  identity ${identityCorrect}/${files.length}  type ${typeCorrect}/${files.length}  macro-F1 ${summary.classification.macroF1}`)
  log(`unsupported facts reaching record: ${unsupportedInRecord}   handwritten auto-extracted: ${handwrittenAuto}`)
  log('recall by class:', JSON.stringify(summary.recallByClass))
  return { summary, ocrPages, excludedHandwritten }
}

export const meanOf = (xs: number[]) => (xs.length ? r4(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
