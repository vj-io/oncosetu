// Groq's free plan (no card): long documents go in chunks, one call each, answers merged; each call asks for the schema
// best-effort with low reasoning; an item that fails the schema is dropped, not the whole answer; and the provider is
// selected from GROQ_API_KEY.
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXTRACTION_SCHEMA_VERSION } from '@/core/extract'
import { CHUNK_WINDOW_MS, chunkPages, llmExtractor, type AiRunRecord } from './extract'
import { llmProvider } from './provider'
import { makeScrubber } from './scrub'

const USAGE = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } }
const HEADER = { name: null, age: null, sex: null, dob: null, mrn: null, report_date: null, institution: null, referring_doctor: null }
const page = (n: number, words: string) => ({ pageNo: n, text: `${words} `.repeat(400).trim() }) // ~ 400 * len/4 tokens

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('Groq (free plan): chunks, best-effort schema, selection', () => {
  it('chunkPages keeps page order and puts about maxTokens in each chunk; a big page goes alone', () => {
    const pages = [page(1, 'aaaa'), page(2, 'bbbb'), page(3, 'cccc'), { pageNo: 4, text: 'x'.repeat(40_000) }, page(5, 'dddd')]
    const chunks = chunkPages(pages, 1000) // each small page ~ 500 tokens
    expect(chunks.map((c) => c.map((p) => p.pageNo))).toEqual([[1, 2], [3], [4], [5]])
  })

  it('sends one call per chunk, each with best-effort schema and low reasoning, and merges the items in page order', async () => {
    const seen: { pages: number[]; providerOptions: unknown; maxOutputTokens?: number; schema: string }[] = []
    const model = new MockLanguageModelV4({
      provider: 'groq', modelId: 'openai/gpt-oss-120b',
      doGenerate: async (opts) => {
        const prompt = JSON.stringify(opts.prompt)
        const pages = [...prompt.matchAll(/=== PAGE (\d+) ===/g)].map((m) => Number(m[1]))
        seen.push({ pages, providerOptions: opts.providerOptions, maxOutputTokens: opts.maxOutputTokens, schema: JSON.stringify(opts.responseFormat) })
        const items = pages.map((n) => ({ event_type: 'procedure_documented', fields: { procedure_text: `Procedure ${n}` }, quote: `Procedure noted on page ${n} of the report.`, page_no: n }))
        items.push({ event_type: 'not_an_event', fields: {}, quote: 'Not a real event type on this page.', page_no: 99 } as never) // fails the schema: dropped alone
        const answer = { schema_version: EXTRACTION_SCHEMA_VERSION, doc_type: 'discharge_summary', header: HEADER, items }
        return { content: [{ type: 'text', text: JSON.stringify(answer) }], finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE, warnings: [] }
      },
    })
    const runs: AiRunRecord[] = []
    const pages = [page(1, 'aaaa'), page(2, 'bbbb'), page(3, 'cccc')]
    const out = await llmExtractor({ provider: 'groq', modelId: 'openai/gpt-oss-120b', model, maxInputTokens: 1000, maxOutputTokens: 2500 }, runs, null, makeScrubber({ name: 'Nobody Here' }))(pages, 'discharge_summary')
    expect(seen.map((s) => s.pages)).toEqual([[1, 2], [3]])
    for (const s of seen) expect(s.maxOutputTokens).toBe(2500)
    for (const s of seen) expect(s.schema).toContain('procedure_documented') // the plain copy: no const or length bounds
    for (const s of seen) expect(s.schema).not.toMatch(/"const"|"maxLength"|"minLength"/)
    for (const s of seen) expect(s.providerOptions).toMatchObject({ groq: { structuredOutputs: true, strictJsonSchema: false, reasoningEffort: 'low' } })
    expect(out!.items.map((i) => i.page_no)).toEqual([1, 2, 3])
    expect(runs.map((r) => r.outcome)).toEqual(['ok', 'ok'])
  })

  it('a chunk that fails does not lose the others; all failing falls back to the rules (null)', async () => {
    let n = 0
    const model = new MockLanguageModelV4({
      provider: 'groq', modelId: 'm',
      doGenerate: async () => {
        if (n++ === 0) throw new Error('network down')
        const answer = { schema_version: EXTRACTION_SCHEMA_VERSION, doc_type: 'discharge_summary', header: HEADER, items: [{ event_type: 'procedure_documented', fields: { procedure_text: 'X' }, quote: 'Procedure noted on page 3 of the report.', page_no: 3 }] }
        return { content: [{ type: 'text', text: JSON.stringify(answer) }], finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE, warnings: [] }
      },
    })
    const out = await llmExtractor({ provider: 'groq', modelId: 'm', model, maxInputTokens: 1000 }, [], null)([page(1, 'aaaa'), page(2, 'bbbb'), page(3, 'cccc')], 'discharge_summary')
    expect(out!.items.map((i) => i.page_no)).toEqual([3])
    const dead = new MockLanguageModelV4({ provider: 'groq', modelId: 'm', doGenerate: async () => { throw new Error('down') } })
    expect(await llmExtractor({ provider: 'groq', modelId: 'm', model: dead, maxInputTokens: 1000 }, [], null)([page(1, 'aaaa')], 'discharge_summary')).toBeNull()
  })

  it('GROQ_API_KEY selects Groq (gpt-oss-120b by default, chunks of 4000 tokens); GROQ_MODEL and GROQ_MAX_INPUT_TOKENS override', () => {
    for (const k of ['ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'AI_ENABLED', 'GROQ_MODEL', 'GROQ_MAX_INPUT_TOKENS', 'GROQ_MAX_OUTPUT_TOKENS']) vi.stubEnv(k, '')
    vi.stubEnv('GROQ_API_KEY', 'gsk_test')
    expect(llmProvider()).toMatchObject({ provider: 'groq', modelId: 'openai/gpt-oss-120b', maxInputTokens: 4000, maxOutputTokens: 3000, augmentRules: true })
    vi.stubEnv('GROQ_MODEL', 'openai/gpt-oss-20b'); vi.stubEnv('GROQ_MAX_INPUT_TOKENS', '3000'); vi.stubEnv('GROQ_MAX_OUTPUT_TOKENS', '2000')
    expect(llmProvider()).toMatchObject({ provider: 'groq', modelId: 'openai/gpt-oss-20b', maxInputTokens: 3000, maxOutputTokens: 2000 })
  })

  it('starts no chunk after the time window, so a long document ends inside the function limit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let calls = 0
    const model = new MockLanguageModelV4({
      provider: 'groq', modelId: 'm',
      doGenerate: async () => {
        calls++; vi.setSystemTime(Date.now() + CHUNK_WINDOW_MS + 1) // this call took the whole window
        const answer = { schema_version: EXTRACTION_SCHEMA_VERSION, doc_type: 'discharge_summary', header: HEADER, items: [] }
        return { content: [{ type: 'text', text: JSON.stringify(answer) }], finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE, warnings: [] }
      },
    })
    const out = await llmExtractor({ provider: 'groq', modelId: 'm', model, maxInputTokens: 1000 }, [], null)([page(1, 'aaaa'), page(2, 'bbbb'), page(3, 'cccc'), page(4, 'dddd')], 'discharge_summary')
    expect(calls).toBe(1)
    expect(out).not.toBeNull()
  })
})
