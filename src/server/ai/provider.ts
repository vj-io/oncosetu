// Runtime LLM provider selection (docs/ARCHITECTURE.md "Stack"). The app is fully functional with no LLM:
// every path falls back to the deterministic extractor and goes through the same evidence gate.
//   ANTHROPIC_API_KEY                                   → @ai-sdk/anthropic, model claude-sonnet-5-5
//   GOOGLE_GENERATIVE_AI_API_KEY                        → @ai-sdk/google, GEMINI_MODEL (default gemini-3.5-flash-lite),
//                                                          free tier: every call goes through the shared quota (quota.ts)
//   GROQ_API_KEY                                        → @ai-sdk/groq, GROQ_MODEL (default openai/gpt-oss-120b); free plan, no card:
//                                                          long documents go in chunks of GROQ_MAX_INPUT_TOKENS (default 4000)
//   AI_ENABLED=true + AI_GATEWAY_API_KEY | VERCEL_OIDC_TOKEN | running on Vercel → Vercel AI Gateway, anthropic/claude-sonnet-5.5
//   otherwise                                           → null (rule-based extraction)
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { gateway, type LanguageModel } from 'ai'
import { eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { orgSettings } from '@/db/schema'
import { activeConsent } from '@/server/patients'

export type LlmProvider = {
  provider: 'anthropic' | 'google' | 'groq' | 'gateway'; modelId: string; model: LanguageModel
  /** A provider with a small per-minute token allowance (Groq's free plan): page text goes in chunks of about this many tokens. */
  maxInputTokens?: number
  /** Answer cap; with a per-minute token allowance it has to fit beside the input (default 8000). */
  maxOutputTokens?: number
  /** Free-plan model, recall below the rule library's: its facts are added to the rules' ones, never replace them. */
  augmentRules?: boolean
  /** Tried in order when the primary model is overloaded (503); each attempt still takes a quota slot. */
  fallbacks?: { modelId: string; model: LanguageModel }[]
  /** Set by aiAllowed(): every call then counts against this org's daily budget (PRD §9.6, ai/quota.ts). */
  orgId?: string
}

export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'
export const GEMINI_DEFAULT_FALLBACKS = 'gemini-flash-lite-latest'

// Test seam: `undefined` (the only value production ever sees) means "select from the environment".
let override: LlmProvider | null | undefined

/** Tests only: pins llmProvider() to `p` (null = no provider) until called with undefined. Refuses to run in production. */
export function setLlmProviderForTests(p: LlmProvider | null | undefined): void {
  if (process.env.NODE_ENV === 'production') throw new Error('setLlmProviderForTests is not available in production')
  override = p
}

export function llmProvider(): LlmProvider | null {
  if (override !== undefined) return override
  if (process.env.ANTHROPIC_API_KEY) {
    const modelId = 'claude-sonnet-5-5'
    return { provider: 'anthropic', modelId, model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId) }
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
    const modelId = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL
    const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? GEMINI_DEFAULT_FALLBACKS).split(',').map((m) => m.trim())
      .filter((m) => m && m !== modelId).map((m) => ({ modelId: m, model: google(m) }))
    return { provider: 'google', modelId, model: google(modelId), fallbacks, augmentRules: true }
  }
  if (process.env.GROQ_API_KEY) {
    const modelId = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
    return {
      provider: 'groq', modelId, model: createGroq({ apiKey: process.env.GROQ_API_KEY })(modelId), augmentRules: true,
      maxInputTokens: Number(process.env.GROQ_MAX_INPUT_TOKENS) || 4000, maxOutputTokens: Number(process.env.GROQ_MAX_OUTPUT_TOKENS) || 3000,
    }
  }
  // On Vercel the OIDC token arrives per request (x-vercel-oidc-token), not in the environment; the gateway reads it at call time
  if (process.env.AI_ENABLED === 'true' && (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL === '1')) {
    const modelId = process.env.AI_GATEWAY_MODEL || 'anthropic/claude-sonnet-5.5' // an id from https://ai-gateway.vercel.sh/v1/models
    return { provider: 'gateway', modelId, model: gateway(modelId) }
  }
  return null
}

export type LlmStatus = { on: boolean; provider: LlmProvider['provider'] | null; model: string | null; label: string }

/** For UI: plain "AI-assisted reading: on/off" (no model or provider names). Optionally per org. */
export function llmStatus(orgFlagOn = true): LlmStatus {
  const p = llmProvider()
  if (!p) return { on: false, provider: null, model: null, label: orgFlagOn ? 'AI-assisted reading: switched on, but no reading service is connected on this server, so fixed rules are used' : 'AI-assisted reading: off' }
  if (!orgFlagOn) return { on: false, provider: p.provider, model: p.modelId, label: 'AI-assisted reading: off' }
  return { on: true, provider: p.provider, model: p.modelId, label: 'AI-assisted reading: on' }
}

export async function orgAiFlag(tx: Tx, orgId: string): Promise<boolean> {
  const [row] = await tx.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, orgId))
  return !!row?.flags?.ai_extraction
}

/**
 * Whether this patient's data may go to an LLM right now (checked on use, never cached): a provider is configured,
 * the org flag `ai_extraction` is on, and the patient's latest consent grants purpose `ai` (E-CON-01).
 */
export async function aiAllowed(tx: Tx, orgId: string, patientId: string): Promise<{ provider: LlmProvider | null; reason: 'no_provider' | 'org_flag_off' | 'no_ai_consent' | null }> {
  const provider = llmProvider()
  if (!provider) return { provider: null, reason: 'no_provider' }
  if (!(await orgAiFlag(tx, orgId))) return { provider: null, reason: 'org_flag_off' }
  if (!(await activeConsent(tx, patientId))?.purposes.ai) return { provider: null, reason: 'no_ai_consent' }
  return { provider: { ...provider, orgId }, reason: null }
}
