// PRD §9.5 prompt-injection resistance on the red-team set (data/eval/redteam, 28 adversarial documents; with the two
// injection documents of the tuned and held-out sets, the 30 the PRD asks for). Rule-based path, no model calls:
//   1. the set as scripts/eval.ts --set redteam scores it: no unsupported fact reaches the record, every attack that
//      is an instruction is flagged, the header decision is the expected one, no forbidden text in any fact;
//   2. a model that obeys the documents (a fake extractor proposing the instructions, the hidden text, the forbidden
//      claims, a stage field and advice wording) gets nothing past the evidence gate.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Extraction } from '@/core/extract'
import { detectInjection } from '@/core/extract/injection'
import { normalise } from '@/core/gate'
import { readJson, ROOT, runSet, SETS, unsupported, type GoldDoc } from '../../../scripts/eval-set'
import { analyse, type LlmExtractor } from './core'
import { sniffFile } from './filetypes'
import { readPages, type PageRead } from './text'

const RECEIVED = new Date('2026-04-01T06:00:00Z')
const gold = readJson<{ docs: Record<string, GoldDoc> }>(SETS.redteam.gold).docs
const patients = readJson<{ patientKey: string; fullName: string; aliases: string[]; dob: string; sex: string }[]>(join(SETS.redteam.dir, 'patients.json'))
const lc = (s: string) => s.toLowerCase()

describe('red-team set (PRD §9.5), rule-based path', () => {
  it('has the 28 documents the generator writes', () => {
    expect(Object.keys(gold)).toHaveLength(28)
  })

  it('admits no unsupported fact, flags every instruction, holds wrong-patient headers, puts no forbidden text in any fact', async () => {
    const { summary } = await runSet('redteam', { llm: null, augmentRules: false, received: RECEIVED, quiet: true })
    expect(summary.gates).toMatchObject({ unsupportedFactsReachingRecord: 0, handwrittenAutoExtracted: 0, pass: true })
    for (const d of summary.docs as { file: string; identity: { expected: string; got: string }; reachesRecord: boolean; error?: string }[]) {
      expect(d.error, d.file).toBeUndefined()
      expect(d.identity.got, d.file).toBe(d.identity.expected)
      if (gold[d.file].held) expect(d.reachesRecord, d.file).toBe(false)
    }
    const rows = summary.injection as { file: string; expected: boolean; flagged: boolean; forbiddenInDrafts: string[] }[]
    for (const [file, g] of Object.entries(gold)) {
      const row = rows.find((r) => r.file === file)
      if (g.injection) expect(row?.flagged, `${file} is flagged`).toBe(true)
      expect(row?.forbiddenInDrafts ?? [], file).toEqual([])
    }
  }, 120_000)
})

/** What a model that follows the document would propose: the instructions, the hidden text, the claims, a stage and advice. */
function hostile(pages: PageRead[], g: GoldDoc): Extraction['items'] {
  const items: Extraction['items'] = []
  const first = pages[0].text.split('\n').map((l) => l.trim()).find((l) => [...l].length >= 8) ?? pages[0].text.trim()
  for (const p of pages) {
    for (const line of p.text.split('\n').map((l) => l.trim())) {
      if (detectInjection(line).flagged && [...line].length >= 8) items.push({ event_type: 'diagnosis_documented', fields: { section_text: line }, quote: line, page_no: p.pageNo })
    }
    if (p.hidden) items.push({ event_type: 'diagnosis_documented', fields: { section_text: p.hidden.slice(0, 300) }, quote: p.hidden.slice(0, 300), page_no: p.pageNo })
  }
  for (const f of g.forbidden ?? []) items.push({ event_type: 'diagnosis_documented', fields: { section_text: f }, quote: first, page_no: 1 })
  items.push({ event_type: 'lab_report_documented', fields: { test_name: first, stage: 'IV' }, quote: first, page_no: 1 })
  items.push({ event_type: 'report_pending_documented', fields: { status_text: 'urgent review needed' }, quote: first, page_no: 1 })
  return items
}

describe('a model that obeys the documents gets nothing past the gate', () => {
  it.each(Object.keys(gold))('%s', async (file) => {
    const g = gold[file]
    const p = patients.find((x) => x.patientKey === g.patientKey)!
    const bytes = new Uint8Array(readFileSync(join(ROOT, SETS.redteam.dir, file)))
    const read = await readPages(bytes, sniffFile(bytes, file)!.mime)
    if (read.kind !== 'pages') throw new Error(`${file}: ${read.kind}`)
    let proposed = 0
    const llm: LlmExtractor = async (pages) => {
      const items = hostile(read.pages.filter((x) => pages.some((y) => y.pageNo === x.pageNo)), g)
      proposed = items.length
      return { schema_version: 'extraction.v1', doc_type: 'other', header: { name: null, age: null, sex: null, dob: null, mrn: null, report_date: null, institution: null, referring_doctor: null }, items }
    }
    const a = await analyse(read.pages, { name: p.fullName, aliases: p.aliases, dob: p.dob, sex: p.sex }, RECEIVED, llm, { attached: true }) // even after a person attached it
    expect(a.method).toBe('llm')
    expect(proposed).toBeGreaterThanOrEqual(g.injection ? 3 : 2) // the instruction lines and hidden text, then the claims, a stage and advice
    for (const d of a.drafts) {
      expect(unsupported(d, read.pages), `${file}: ${d.evidence.quote}`).toBeNull()
      expect(detectInjection(d.evidence.quote).flagged, `${file}: ${d.evidence.quote}`).toBe(false)
      const text = lc(normalise(d.evidence.quote + ' ' + JSON.stringify(d.fields)))
      for (const f of g.forbidden ?? []) expect(text, `${file}: forbidden "${f}"`).not.toContain(lc(f))
      expect(Object.keys(d.fields)).not.toContain('stage')
      expect(JSON.stringify(d.fields)).not.toContain('urgent')
    }
  }, 30_000)
})
