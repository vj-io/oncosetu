// LLM extraction call (PRD §9.2, FR-EXT-06). Output is data only: it is schema-validated here and then goes through
// the same evidence gate as the rule-based path. Every call is recorded as an ai_runs row (hashes, no content).
// No `temperature`: the API rejects sampling parameters on current models; determinism comes from the schema + gate.
//
// Free-tier Gemini: every attempt first takes a slot from the shared quota (quota.ts) — no slot, no call, and the
// document is extracted by the rule-based path instead. The SDK's own retries are off (they would spend quota on 429s);
// a 429 starts a cooldown for all instances, a 503 moves to the next fallback model.
import { APICallError, generateText, jsonSchema, NoObjectGeneratedError, Output } from 'ai'
import { z } from 'zod'
import {
  buildExtractionPrompt, EXTRACTION_PROMPT_ID, EXTRACTION_PROMPT_VERSION, EXTRACTION_SCHEMA_VERSION, EXTRACTION_SYSTEM_PROMPT,
  ExtractionSchema, type Extraction,
} from '@/core/extract'
import { sha256Hex } from '@/core/hash'
import type { DocType } from '@/core/types'
import type { LlmExtractor } from '@/server/pipeline/core'
import type { LlmProvider } from './provider'
import { reserveLlmCall, settleLlmCall, type LlmOutcome, type QuotaDenial, type Reservation } from './quota'
import type { Scrubber } from './scrub'

export type AiRunRecord = {
  kind: 'extract'; provider: string; model: string; promptId: string; promptVersion: string; schemaVersion: string
  inputHash: string; outputHash: string | null; latencyMs: number; tokensIn: number | null; tokensOut: number | null
  outcome: 'ok' | 'schema_error' | 'provider_error' | 'rate_limited' | `quota_${QuotaDenial}`
}

export type QuotaFns = {
  reserve: (provider: string, model: string) => Promise<Reservation>
  settle: (id: number, outcome: LlmOutcome, tokens?: number | null) => Promise<void>
}
/** The free-tier key's shared budget (Gemini) and, when the provider is bound to an org, that org's daily budget (PRD §9.6). */
const quotaFor = (p: LlmProvider): QuotaFns | null => (p.provider === 'google' || p.orgId ? {
  reserve: (provider, model) => reserveLlmCall(provider, model, { orgId: p.orgId, shared: p.provider === 'google' }),
  settle: settleLlmCall,
} : null)

// Gemini's response-schema dialect rejects `const` and length/size bounds (400 "invalid argument"); Groq's best-effort mode gets the
// same plain copy. The full ExtractionSchema still validates the answer here, item by item.
const GEMINI_DROP = new Set(['$schema', 'maxLength', 'minLength', 'maxItems', 'minItems', 'maximum', 'minimum', 'exclusiveMaximum', 'exclusiveMinimum'])
export function geminiSchemaOf(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(geminiSchemaOf)
  if (!s || typeof s !== 'object') return s
  return Object.fromEntries(Object.entries(s).filter(([k]) => !GEMINI_DROP.has(k)).map(([k, v]) => (k === 'const' ? ['enum', [v]] : [k, geminiSchemaOf(v)])))
}
let geminiSchema: ReturnType<typeof jsonSchema> | undefined
const outputSchemaFor = (p: LlmProvider) =>
  p.provider === 'google' || p.provider === 'groq' ? (geminiSchema ??= jsonSchema(geminiSchemaOf(z.toJSONSchema(ExtractionSchema)) as Parameters<typeof jsonSchema>[0])) : ExtractionSchema

/** Keeps every item that passes the full schema; one over-long quote must not throw away the whole document. */
export function parseItemwise(raw: unknown): Extraction {
  const r = (raw ?? {}) as { items?: unknown }
  const items = Array.isArray(r.items) ? r.items.filter((it) => ExtractionSchema.shape.items.element.safeParse(it).success) : []
  return ExtractionSchema.parse({ ...r, items })
}

const statusOf = (e: unknown) => (APICallError.isInstance(e) ? e.statusCode : undefined)

/** No new chunk starts after this; with one 90 s call after it, extraction ends well inside a 300 s function. */
export const CHUNK_WINDOW_MS = 150_000

/** Page groups of about `maxTokens` each (4 characters a token), in page order; a page larger than that goes alone. */
export function chunkPages<P extends { text: string }>(pages: P[], maxTokens: number): P[][] {
  const chunks: P[][] = []
  let cur: P[] = [], used = 0
  for (const pg of pages) {
    const t = Math.ceil(pg.text.length / 4)
    if (cur.length && used + t > maxTokens) { chunks.push(cur); cur = []; used = 0 }
    cur.push(pg); used += t
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

/**
 * An extractor bound to a provider; pushes one AiRunRecord per attempt into `runs`. At most three attempts:
 * one retry on a schema failure, and one step down the fallback list per 503. Quota: the free-tier provider's shared
 * budget, plus the org's daily call/token budget for any provider bound to an org (aiAllowed does that).
 * A provider with `maxInputTokens` (Groq's free plan) gets the pages in chunks, one call each; the answers are merged.
 */
export function llmExtractor(p: LlmProvider, runs: AiRunRecord[], quota: QuotaFns | null = quotaFor(p), scrubber?: Scrubber): LlmExtractor {
  const once = async (pages: { pageNo: number; text: string }[], docType: DocType): Promise<Extraction | null> => {
    // the provider sees the page text without this patient's identifiers (scrub.ts); the answer gets them back below
    const prompt = buildExtractionPrompt(scrubber ? pages.map((pg) => ({ ...pg, text: scrubber.scrub(pg.text) })) : pages, docType)
    const models = [{ modelId: p.modelId, model: p.model }, ...(p.fallbacks ?? [])]
    const inputHash = sha256Hex(EXTRACTION_SYSTEM_PROMPT + '\n' + prompt)
    let mi = 0
    for (let attempt = 1; attempt <= 3; attempt++) {
      const m = models[mi]
      const base = {
        kind: 'extract' as const, provider: p.provider, model: m.modelId, promptId: EXTRACTION_PROMPT_ID,
        promptVersion: String(EXTRACTION_PROMPT_VERSION), schemaVersion: EXTRACTION_SCHEMA_VERSION, inputHash,
      }
      const none = { outputHash: null, latencyMs: 0, tokensIn: null, tokensOut: null }
      let slot: number | null = null
      if (quota) {
        const r = await quota.reserve(p.provider, m.modelId)
        if ('denied' in r) { runs.push({ ...base, ...none, outcome: `quota_${r.denied}` }); return null }
        slot = r.id
      }
      const t0 = Date.now()
      try {
        const res = await generateText({
          model: m.model, instructions: EXTRACTION_SYSTEM_PROMPT, prompt, output: Output.object({ schema: outputSchemaFor(p) }),
          // paid providers: SDK retries 429/5xx (E-DOC-20); Groq's free plan: up to 3 waits of the retry-after it sends
          maxOutputTokens: p.maxOutputTokens ?? 8000, maxRetries: p.provider === 'google' ? 0 : p.provider === 'groq' ? 3 : 2,
          abortSignal: AbortSignal.timeout(90_000),
          // via AI Gateway: only providers that do not train on prompts and keep no copy of them
          ...(p.provider === 'gateway' ? { providerOptions: { gateway: { disallowPromptTraining: true, zeroDataRetention: process.env.AI_ZERO_DATA_RETENTION !== 'false' } } } : {}),
          // Groq: schema followed best-effort (strict mode needs every field required); short reasoning saves the minute's tokens;
          // temperature 0 because at the default about half the answers (live, demo summary) came back with no items at all
          ...(p.provider === 'groq' ? { temperature: 0, providerOptions: { groq: { structuredOutputs: true, strictJsonSchema: false, reasoningEffort: 'low' } } } : {}),
        })
        const parsed = p.provider === 'google' || p.provider === 'groq' ? parseItemwise(res.output) : ExtractionSchema.parse(res.output)
        const out = scrubber ? scrubber.restore(parsed) : parsed
        const tokensIn = res.usage.inputTokens ?? null, tokensOut = res.usage.outputTokens ?? null
        if (slot !== null) await quota!.settle(slot, 'ok', (tokensIn ?? 0) + (tokensOut ?? 0))
        runs.push({ ...base, outputHash: sha256Hex(JSON.stringify(out)), latencyMs: Date.now() - t0, tokensIn, tokensOut, outcome: 'ok' })
        return out
      } catch (e) {
        const schemaError = NoObjectGeneratedError.isInstance(e) || (e as { name?: string })?.name === 'ZodError'
        const status = statusOf(e)
        const outcome: LlmOutcome = schemaError ? 'schema_error' : status === 429 ? 'rate_limited' : 'provider_error'
        if (slot !== null) await quota!.settle(slot, outcome)
        runs.push({ ...base, outputHash: null, latencyMs: Date.now() - t0, tokensIn: null, tokensOut: null, outcome })
        if (schemaError) { if (attempt >= 2) return null; continue } // one retry, then the rule-based path
        if ((status === 503 || status === 500) && mi + 1 < models.length) { mi++; continue } // overloaded → next model
        return null // 429, other 4xx, timeout, network → rule-based path, never data loss
      }
    }
    return null
  }
  return async (pages, docType) => {
    if (!p.maxInputTokens) return once(pages, docType)
    const outs: Extraction[] = [], stopAt = Date.now() + CHUNK_WINDOW_MS
    for (const chunk of chunkPages(pages, p.maxInputTokens)) {
      if (Date.now() > stopAt) break // later pages keep the rule-based facts (augmentRules); the run must end inside the function's 300 s
      const o = await once(chunk, docType); if (o) outs.push(o)
    }
    if (!outs.length) return null
    return { ...outs[0], items: outs.flatMap((o) => o.items) } // type and header from the first chunk that answered
  }
}
