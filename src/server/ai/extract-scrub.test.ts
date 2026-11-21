// What an AI provider receives from the extractor: the page text without the patient's identifiers (scrub.ts), and for
// AI Gateway the no-training / zero-retention routing options. The answer comes back with the original text restored.
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it } from 'vitest'
import { EXTRACTION_SCHEMA_VERSION } from '@/core/extract'
import { llmExtractor, type AiRunRecord } from './extract'
import { makeScrubber } from './scrub'

const PAGE = 'Patient: SUNITA DESHMUKH  UHID KH-0042-1187  DOB 14/08/1974  Ph 9876543210\nWide local excision of left breast lump done on 12/03/2026 under GA for Sunita.'
const id = { name: 'Sunita Deshmukh', aliases: [], dob: '1974-08-14', mrns: ['KH-0042-1187'] }
const USAGE = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } }

function recording(provider: 'gateway' | 'anthropic') {
  const seen: { prompt: string; providerOptions: unknown }[] = []
  const model = new MockLanguageModelV4({
    provider, modelId: 'm',
    doGenerate: async (opts) => {
      const prompt = JSON.stringify(opts.prompt)
      seen.push({ prompt, providerOptions: opts.providerOptions })
      // the model copies a quote and the header from the text it was given (placeholders included)
      const quote = /Wide local excision[^\\"]*?\./.exec(prompt)![0] // copied from the scrubbed text it was given
      const answer = { schema_version: EXTRACTION_SCHEMA_VERSION, doc_type: 'discharge_summary',
        header: { name: '[PATIENT_NAME_1] [PATIENT_NAME_2]', age: null, sex: null, dob: '[DOB_1]', mrn: '[PATIENT_ID_1]', report_date: null, institution: null, referring_doctor: null },
        items: [{ event_type: 'procedure_documented', fields: { procedure_text: 'Wide local excision' }, quote, page_no: 1 }] }
      return { content: [{ type: 'text', text: JSON.stringify(answer) }], finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE, warnings: [] }
    },
  })
  return { model, seen }
}

afterEach(() => { delete process.env.AI_ZERO_DATA_RETENTION })

describe('what the AI provider receives', () => {
  it('no name, hospital number, birth date or phone in the prompt; the answer gets the original text back', async () => {
    const { model, seen } = recording('anthropic')
    const runs: AiRunRecord[] = []
    const out = await llmExtractor({ provider: 'anthropic', modelId: 'm', model }, runs, null, makeScrubber(id))([{ pageNo: 1, text: PAGE }], 'discharge_summary')
    expect(seen).toHaveLength(1)
    for (const leak of ['SUNITA', 'Sunita', 'DESHMUKH', 'KH-0042-1187', '14/08/1974', '9876543210']) expect(seen[0].prompt).not.toContain(leak)
    expect(seen[0].prompt).toContain('Wide local excision of left breast lump')
    expect(PAGE).toContain(out!.items[0].quote) // restored quote is on the original page, so the evidence gate can accept it
    expect(out!.header).toMatchObject({ name: 'SUNITA DESHMUKH', dob: '14/08/1974', mrn: 'KH-0042-1187' })
  })

  it('through AI Gateway, asks for providers that do not train on prompts and keep no copy (zero retention can be turned off)', async () => {
    const a = recording('gateway')
    await llmExtractor({ provider: 'gateway', modelId: 'm', model: a.model }, [], null, makeScrubber(id))([{ pageNo: 1, text: PAGE }], 'discharge_summary')
    expect(a.seen[0].providerOptions).toMatchObject({ gateway: { disallowPromptTraining: true, zeroDataRetention: true } })
    process.env.AI_ZERO_DATA_RETENTION = 'false'
    const b = recording('gateway')
    await llmExtractor({ provider: 'gateway', modelId: 'm', model: b.model }, [], null, makeScrubber(id))([{ pageNo: 1, text: PAGE }], 'discharge_summary')
    expect(b.seen[0].providerOptions).toMatchObject({ gateway: { disallowPromptTraining: true, zeroDataRetention: false } })
    const c = recording('anthropic')
    await llmExtractor({ provider: 'anthropic', modelId: 'm', model: c.model }, [], null, makeScrubber(id))([{ pageNo: 1, text: PAGE }], 'discharge_summary')
    expect((c.seen[0].providerOptions as { gateway?: unknown } | undefined)?.gateway).toBeUndefined()
  })
})
