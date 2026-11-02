/**
 * Offline pipeline evaluation (PRD §9.5, adapted to the synthetic demo set). Runs the SAME pure pipeline functions as
 * the server (src/server/pipeline/text.ts + core.ts) over every file in public/demo-docs, compares against the
 * hand-authored gold in data/eval/gold.json and writes data/eval/report.json (read by the source viewer's coverage note).
 *
 *   npx tsx --env-file=.env.local scripts/eval.ts          # rule-based path (no LLM)
 *   npx tsx --env-file=.env.local scripts/eval.ts --llm    # LLM path, if a provider is configured
 *
 * Exit code 1 when a hard gate fails: an unsupported fact reached the record, or a handwritten page was auto-extracted.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { normalise } from '../src/core/gate'
import { DOC_TYPES } from '../src/core/types'
import { llmExtractor, type AiRunRecord } from '../src/server/ai/extract'
import { reserveLlmCallWaiting, settleLlmCall } from '../src/server/ai/quota'
import { llmProvider } from '../src/server/ai/provider'
import { analyse, type DraftEvent } from '../src/server/pipeline/core'
import { sniffMime } from '../src/server/pipeline/safety'
import { closeOcr, readPages, type PageRead } from '../src/server/pipeline/text'

const ROOT = resolve(dirname(process.argv[1] ?? '.'), '..')
const DOCS = join(ROOT, 'public', 'demo-docs')
type GoldEvent = { type: string; date?: string; match?: string }
type GoldDoc = { patientKey: string; docType: string; identity: string; handwritten?: boolean; held?: boolean; injection?: boolean; addendum?: boolean; forbidden?: string[]; events: GoldEvent[] }
type Patient = { patientKey: string; fullName: string; aliases: string[]; dob: string; sex: string }

const gold = JSON.parse(readFileSync(join(ROOT, 'data/eval/gold.json'), 'utf8')) as { docs: Record<string, GoldDoc> }
const patients = JSON.parse(readFileSync(join(DOCS, 'patients.json'), 'utf8')) as Patient[]
const useLlm = process.argv.includes('--llm')
const provider = useLlm ? llmProvider() : null
if (useLlm && !provider) console.warn('--llm given but no provider is configured: running the rule-based path')
const runs: AiRunRecord[] = []
const RECEIVED = new Date()

const lc = (s: string) => s.toLowerCase()
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

async function main() {
const perDoc: Row[] = []
const byClass: Record<string, { gold: number; found: number; pred: number; correct: number }> = {}
let unsupportedInRecord = 0
let handwrittenAuto = 0
let identityCorrect = 0
let typeCorrect = 0
const injectionRows: Row[] = []

const files = Object.keys(gold.docs).sort()
for (const file of files) {
  const g = gold.docs[file]
  const p = patients.find((x) => x.patientKey === g.patientKey)!
  const bytes = new Uint8Array(readFileSync(join(DOCS, file)))
  const t0 = Date.now()
  const read = await readPages(bytes, sniffMime(bytes)!)
  if (read.kind !== 'pages') {
    perDoc.push({ file, error: read.kind })
    continue
  }
  const a = await analyse(read.pages, { name: p.fullName, aliases: p.aliases, dob: p.dob, sex: p.sex }, RECEIVED, provider ? llmExtractor(provider, runs, provider.provider === 'google' ? { reserve: reserveLlmCallWaiting, settle: settleLlmCall } : null) : null, { augmentRules: provider?.provider === 'google' })
  const reachesRecord = a.identified.identity.result === 'match'
  const recordDrafts = reachesRecord ? a.drafts : []
  const problems = recordDrafts.map((d) => ({ d, why: unsupported(d, read.pages) })).filter((x) => x.why)
  unsupportedInRecord += problems.length
  if (g.handwritten) handwrittenAuto += a.drafts.length

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
  console.log(`${file.padEnd(44)} id=${a.identified.identity.result.padEnd(12)} type=${a.classified.docType.padEnd(22)} found ${goldHit.filter(Boolean).length}/${g.events.length}  correct ${predOk.filter(Boolean).length}/${a.drafts.length}`)
}
await closeOcr()

const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null)
const tot = Object.values(byClass).reduce((a, c) => ({ gold: a.gold + c.gold, found: a.found + c.found, pred: a.pred + c.pred, correct: a.correct + c.correct }), { gold: 0, found: 0, pred: 0, correct: 0 })
const report = {
  generatedAt: new Date().toISOString(),
  method: provider ? `llm:${provider.modelId}` : 'rules',
  dataset: `${files.length} synthetic documents in public/demo-docs (gold: data/eval/gold.json)`,
  note: 'Precision counts an extracted event correct when it matches at least one gold fact (type, date, text); recall counts gold facts found. Held documents (identity not matched) are scored on what would be extracted after a person attaches them; nothing from them reaches the record.',
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
  classification: { correct: typeCorrect, total: files.length, accuracy: ratio(typeCorrect, files.length) },
  injection: injectionRows,
  aiRuns: runs.map((r) => ({ outcome: r.outcome, latencyMs: r.latencyMs, tokensIn: r.tokensIn, tokensOut: r.tokensOut })),
  docs: perDoc,
}
writeFileSync(join(ROOT, provider ? 'data/eval/report-llm.json' : 'data/eval/report.json'), JSON.stringify(report, null, 2) + '\n') // the source viewer's coverage note reads the rule-path report
console.log(`\nprecision ${report.precision}  recall ${report.recall}  identity ${identityCorrect}/${files.length}  type ${typeCorrect}/${files.length}`)
console.log(`unsupported facts reaching record: ${unsupportedInRecord}   handwritten auto-extracted: ${handwrittenAuto}`)
console.log('recall by class:', JSON.stringify(report.recallByClass))
if (!report.gates.pass) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
