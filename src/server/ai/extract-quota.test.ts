// Free-tier (Gemini) path of the LLM extractor: shared quota, no SDK retry on 429, fallback model on 503,
// Gemini-compatible response schema and item-by-item validation. The quota functions are injected; the shared
// Postgres limiter itself is proven in tests/integration/llm-quota.test.ts.
import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { EXTRACTION_SCHEMA_VERSION, ExtractionSchema } from '@/core/extract'
import { geminiSchemaOf, llmExtractor, parseItemwise, type AiRunRecord, type QuotaFns } from './extract'
import type { LlmProvider } from './provider'

const NULL_HEADER = { name: null, age: null, sex: null, dob: null, mrn: null, report_date: null, institution: null, referring_doctor: null }
const QUOTE = 'Wide local excision done on 12/03/2026 under GA.'
const good = { schema_version: EXTRACTION_SCHEMA_VERSION, doc_type: 'discharge_summary', header: NULL_HEADER,
  items: [{ event_type: 'procedure_documented', fields: { procedure_text: 'Wide local excision' }, quote: QUOTE, page_no: 2 }] }
const USAGE = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } }
const err = (statusCode: number) => new APICallError({ message: `status ${statusCode}`, url: 'https://generativelanguage.googleapis.com', requestBodyValues: {}, statusCode, isRetryable: statusCode >= 500 })

function model(id: string, ...steps: unknown[]) {
  let i = 0
  const m = new MockLanguageModelV4({
    provider: 'google', modelId: id,
    doGenerate: async () => {
      const s = steps[Math.min(i++, steps.length - 1)]
      if (s instanceof Error) throw s
      return { content: [{ type: 'text', text: JSON.stringify(s) }], finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE, warnings: [] }
    },
  })
  return { m, calls: () => i }
}
const provider = (primary: MockLanguageModelV4, fallback?: MockLanguageModelV4): LlmProvider => ({
  provider: 'google', modelId: 'gemini-primary', model: primary, fallbacks: fallback ? [{ modelId: 'gemini-fallback', model: fallback }] : [],
})
function quota(grant: (n: number) => boolean | 'rpm' | 'rpd' | 'cooldown' = () => true) {
  const settled: [number, string][] = []
  let n = 0
  const fns: QuotaFns = {
    reserve: async () => { const g = grant(++n); return g === true ? { id: n } : { denied: g === false ? 'rpm' : g } },
    settle: async (id, outcome) => { settled.push([id, outcome]) },
  }
  return { fns, settled, reserved: () => n }
}
const PAGES = [{ pageNo: 1, text: 'DISCHARGE SUMMARY' }, { pageNo: 2, text: QUOTE }]

describe('free-tier LLM extractor', () => {
  it('takes a quota slot per call and settles it ok', async () => {
    const { m, calls } = model('gemini-primary', good)
    const q = quota(), runs: AiRunRecord[] = []
    const out = await llmExtractor(provider(m), runs, q.fns)(PAGES, 'discharge_summary')
    expect(out?.items).toHaveLength(1)
    expect([calls(), q.reserved()]).toEqual([1, 1])
    expect(q.settled).toEqual([[1, 'ok']])
    expect(runs.map((r) => r.outcome)).toEqual(['ok'])
  })

  it('no quota slot → the model is never called and the rule-based path takes over', async () => {
    for (const reason of ['rpm', 'rpd', 'cooldown'] as const) {
      const { m, calls } = model('gemini-primary', good)
      const q = quota(() => reason), runs: AiRunRecord[] = []
      expect(await llmExtractor(provider(m), runs, q.fns)(PAGES, 'discharge_summary')).toBeNull()
      expect(calls()).toBe(0)
      expect(runs.map((r) => r.outcome)).toEqual([`quota_${reason}`])
    }
  })

  it('a 429 is not retried (no quota burned) and is settled as rate_limited', async () => {
    const { m, calls } = model('gemini-primary', err(429))
    const q = quota(), runs: AiRunRecord[] = []
    expect(await llmExtractor(provider(m), runs, q.fns)(PAGES, 'discharge_summary')).toBeNull()
    expect(calls()).toBe(1)
    expect(q.settled).toEqual([[1, 'rate_limited']])
  })

  it('a 503 moves to the fallback model, which takes its own slot', async () => {
    const p = model('gemini-primary', err(503)), f = model('gemini-fallback', good)
    const q = quota(), runs: AiRunRecord[] = []
    const out = await llmExtractor(provider(p.m, f.m), runs, q.fns)(PAGES, 'discharge_summary')
    expect(out?.items).toHaveLength(1)
    expect([p.calls(), f.calls(), q.reserved()]).toEqual([1, 1, 2])
    expect(runs.map((r) => [r.model, r.outcome])).toEqual([['gemini-primary', 'provider_error'], ['gemini-fallback', 'ok']])
  })

  it('a 503 with no fallback left ends on the rule-based path', async () => {
    const { m, calls } = model('gemini-primary', err(503))
    const q = quota(), runs: AiRunRecord[] = []
    expect(await llmExtractor(provider(m), runs, q.fns)(PAGES, 'discharge_summary')).toBeNull()
    expect(calls()).toBe(1)
  })

  it('a second attempt is refused when the minute budget runs out between attempts', async () => {
    const { m, calls } = model('gemini-primary', '{not json', good)
    const q = quota((n) => (n === 1 ? true : 'rpm')), runs: AiRunRecord[] = []
    expect(await llmExtractor(provider(m), runs, q.fns)(PAGES, 'discharge_summary')).toBeNull()
    expect(calls()).toBe(1)
    expect(runs.map((r) => r.outcome)).toEqual(['schema_error', 'quota_rpm'])
  })

  it('keeps valid items when one item breaks the schema (over-long quote)', () => {
    const out = parseItemwise({ ...good, items: [...good.items, { event_type: 'procedure_documented', fields: {}, quote: 'x'.repeat(301), page_no: 1 }] })
    expect(out.items).toHaveLength(1)
    expect(() => parseItemwise({ ...good, header: 'nope' })).toThrow()
  })

  it('sends Gemini a schema without const and length bounds, keeping the structure', () => {
    const s = JSON.stringify(geminiSchemaOf(z.toJSONSchema(ExtractionSchema)))
    for (const k of ['"const"', '"maxLength"', '"maxItems"', '"minLength"', '"maximum"', '"minimum"', '"$schema"']) expect(s).not.toContain(k)
    expect(s).toContain('"enum":["extraction.v1"]')
    expect(s).toContain('"procedure_documented"')
  })
})
