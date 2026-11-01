// LLM extraction call (PRD §9.2, FR-EXT-06). Output is data only: it is schema-validated here and then goes through
// the same evidence gate as the rule-based path. Every call is recorded as an ai_runs row (hashes, no content).
// No `temperature`: the API rejects sampling parameters on current models; determinism comes from the schema + gate.
import { generateText, NoObjectGeneratedError, Output } from 'ai'
import {
  buildExtractionPrompt, EXTRACTION_PROMPT_ID, EXTRACTION_PROMPT_VERSION, EXTRACTION_SCHEMA_VERSION, EXTRACTION_SYSTEM_PROMPT,
  ExtractionSchema, type Extraction,
} from '@/core/extract'
import { sha256Hex } from '@/core/hash'
import type { DocType } from '@/core/types'
import type { LlmExtractor } from '@/server/pipeline/core'
import type { LlmProvider } from './provider'

export type AiRunRecord = {
  kind: 'extract'; provider: string; model: string; promptId: string; promptVersion: string; schemaVersion: string
  inputHash: string; outputHash: string | null; latencyMs: number; tokensIn: number | null; tokensOut: number | null
  outcome: 'ok' | 'schema_error' | 'provider_error'
}

/** An extractor bound to a provider; pushes one AiRunRecord per call into `runs`. One retry on schema failure. */
export function llmExtractor(p: LlmProvider, runs: AiRunRecord[]): LlmExtractor {
  return async (pages: { pageNo: number; text: string }[], docType: DocType): Promise<Extraction | null> => {
    const prompt = buildExtractionPrompt(pages, docType)
    const base = {
      kind: 'extract' as const, provider: p.provider, model: p.modelId, promptId: EXTRACTION_PROMPT_ID,
      promptVersion: String(EXTRACTION_PROMPT_VERSION), schemaVersion: EXTRACTION_SCHEMA_VERSION,
      inputHash: sha256Hex(EXTRACTION_SYSTEM_PROMPT + '\n' + prompt),
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const t0 = Date.now()
      try {
        const res = await generateText({
          model: p.model, instructions: EXTRACTION_SYSTEM_PROMPT, prompt, output: Output.object({ schema: ExtractionSchema }),
          maxOutputTokens: 8000, maxRetries: 2, // SDK retries 429/5xx with exponential backoff (E-DOC-20)
        })
        const out = ExtractionSchema.parse(res.output)
        runs.push({ ...base, outputHash: sha256Hex(JSON.stringify(out)), latencyMs: Date.now() - t0, tokensIn: res.usage.inputTokens ?? null, tokensOut: res.usage.outputTokens ?? null, outcome: 'ok' })
        return out
      } catch (e) {
        const schemaError = NoObjectGeneratedError.isInstance(e) || (e as { name?: string })?.name === 'ZodError'
        runs.push({ ...base, outputHash: null, latencyMs: Date.now() - t0, tokensIn: null, tokensOut: null, outcome: schemaError ? 'schema_error' : 'provider_error' })
        if (!schemaError) return null // provider down → rule-based path, never data loss
      }
    }
    return null
  }
}
