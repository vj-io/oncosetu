// PRD §9.5 extraction evaluation, from the reports scripts/eval.ts writes (synthetic sets, offline, not live data).
import { Badge, Table } from '@/components/ui'
import { staffDocLabel } from '@/core/copy'
import type { DocType } from '@/core/types'
import rules from '../../../data/eval/report.json'
import hybrid from '../../../data/eval/report-llm.json'
import { Block } from './charts'

type Gates = { unsupportedFactsReachingRecord: number; handwrittenAutoExtracted: number }
type ClassRecall = Record<string, { recall: number | null; gold: number }>
type SetReport = {
  precision: number | null; recall: number | null; gates: Gates; recallByClass: ClassRecall
  identity: { correct: number; total: number }; classification: { macroF1?: number }
  untouchedLabels?: { precision: number | null; recall: number | null }
}
type Report = SetReport & { generatedAt: string; heldout?: SetReport; ocr?: { cer: number; maxCer: number; pagesScored: number } }

const R = rules as unknown as Report
const H = hybrid as unknown as Report
// Held-out is shown twice on purpose. The first column scores only the labels written before the oncology fact types existed.
// The second adds the new types, whose rules were tuned using some of the held-out documents, so it is optimistic.
const untouched = (r: SetReport | undefined): SetReport | undefined => (r?.untouchedLabels ? { ...r, precision: r.untouchedLabels.precision, recall: r.untouchedLabels.recall } : r)
const cols: { label: string; r: SetReport | undefined }[] = [
  { label: 'Tuned · rules', r: R },
  { label: 'Held-out (documents written after the rules were fixed) · rules, untouched labels', r: untouched(R.heldout) },
  { label: 'Held-out · rules, after adding oncology fact types (rules tuned using some of these documents)', r: R.heldout },
  { label: 'Held-out · rules + AI-assisted (4 Nov run, before the oncology types)', r: H.heldout },
]
const num = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(3))
const ROWS: { label: string; target: string; value: (r: SetReport) => string; ok: (r: SetReport) => boolean | null }[] = [
  { label: 'Unsupported facts reaching the record', target: '0', value: (r) => String(r.gates.unsupportedFactsReachingRecord), ok: (r) => r.gates.unsupportedFactsReachingRecord === 0 },
  { label: 'Handwritten pages auto-extracted', target: '0', value: (r) => String(r.gates.handwrittenAutoExtracted), ok: (r) => r.gates.handwrittenAutoExtracted === 0 },
  { label: 'Event precision', target: '≥ 0.95', value: (r) => num(r.precision), ok: (r) => (r.precision == null ? null : r.precision >= 0.95) },
  { label: 'Event recall (omission)', target: '≥ 0.85', value: (r) => num(r.recall), ok: (r) => (r.recall == null ? null : r.recall >= 0.85) },
  { label: 'Classification macro-F1', target: '≥ 0.85', value: (r) => num(r.classification.macroF1), ok: (r) => (r.classification.macroF1 == null ? null : r.classification.macroF1 >= 0.85) },
  { label: 'Identity decision as expected', target: 'held, never wrong', value: (r) => `${r.identity.correct} / ${r.identity.total}`, ok: () => null },
]

function Cell({ r, row }: { r: SetReport | undefined; row: (typeof ROWS)[number] }) {
  if (!r) return <td className="text-muted">Not run</td>
  const ok = row.ok(r)
  return (
    <td className="font-mono text-[15px] tabular-nums whitespace-nowrap">
      {row.value(r)} {ok !== null && <Badge tone={ok ? 'verified' : 'unverified'}>{ok ? 'Meets' : 'Misses'}</Badge>}
    </td>
  )
}

export function EvalReport() {
  const ocr = R.ocr
  const classes = Object.entries(R.heldout?.recallByClass ?? {}).filter(([, v]) => v.gold > 0)
  return (
    <Block kicker="Reading accuracy" title="How accurately documents are read (synthetic documents)"
      note={<>Offline runs of the same pipeline code over synthetic documents, not live data. Tuned: the 20 demo documents the rule library was developed on (optimistic). Held-out: 40 documents written after the rules were frozen; the “untouched labels” column scores only the labels written then, and the next column adds the oncology fact types (stage, marker results, margins, impression, addendum, regimen), whose rules were tuned using some of these documents, so treat that column as optimistic. Its first blind run found one handwritten page auto-extracted, since fixed; that run is kept in <code>data/eval/heldout-blind-run.json</code>. Rules run {R.generatedAt.slice(0, 10)}, AI-assisted run {H.generatedAt.slice(0, 10)}. Regenerate with <code>scripts/eval.ts</code>.</>}>
      <Table caption="Results against the targets we set">
        <thead><tr><th>Metric</th><th>Target</th>{cols.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}><td>{row.label}</td><td className="font-mono text-[13px] whitespace-nowrap">{row.target}</td>{cols.map((c) => <Cell key={c.label} r={c.r} row={row} />)}</tr>
          ))}
          {ocr && (
            <tr>
              <td>Photo-reading error rate: share of characters misread, printed photographed pages ({ocr.pagesScored})</td><td className="font-mono text-[13px]">≤ 5%</td>
              <td colSpan={3} className="font-mono text-[15px] tabular-nums">
                {(ocr.cer * 100).toFixed(1)}% mean · {(ocr.maxCer * 100).toFixed(1)}% worst <Badge tone={ocr.cer <= 0.05 ? 'verified' : 'unverified'}>{ocr.cer <= 0.05 ? 'Meets' : 'Misses'}</Badge>
              </td>
            </tr>
          )}
        </tbody>
      </Table>
      <Table caption="Held-out recall by document type (shown to verifiers as the coverage note)">
        <thead><tr><th>Document type</th><th>Gold facts</th><th>Rules</th><th>Rules + AI-assisted</th></tr></thead>
        <tbody>
          {classes.map(([t, v]) => {
            const h = H.heldout?.recallByClass?.[t]
            return (
              <tr key={t}>
                <td>{staffDocLabel(t as DocType)}</td><td className="font-mono tabular-nums">{v.gold}</td>
                <td className={`font-mono tabular-nums ${v.recall != null && v.recall < 0.85 ? 'text-amber-ink' : ''}`}>{num(v.recall)}</td>
                <td className={`font-mono tabular-nums ${h?.recall != null && h.recall < 0.85 ? 'text-amber-ink' : ''}`}>{num(h?.recall)}</td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <p className="text-sm text-faint">Per-type counts are small (1 to 30 facts), so per-type recall is noisy. The sets are authored by the team and not yet reviewed by the clinician advisor.</p>
    </Block>
  )
}
