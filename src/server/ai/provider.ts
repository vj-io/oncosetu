// Runtime LLM provider selection (docs/ARCHITECTURE.md "Stack"). The app is fully functional with no LLM:
// every path falls back to the deterministic extractor and goes through the same evidence gate.
//   ANTHROPIC_API_KEY                                   → @ai-sdk/anthropic, model claude-sonnet-5-5
//   GOOGLE_GENERATIVE_AI_API_KEY                        → @ai-sdk/google, GEMINI_MODEL (default gemini-3.5-flash-lite),
//                                                          free tier: every call goes through the shared quota (quota.ts)
//   AI_ENABLED=true + AI_GATEWAY_API_KEY | VERCEL_OIDC_TOKEN → Vercel AI Gateway, anthropic/claude-sonnet-5.5
//   otherwise                                           → null (rule-based extraction)
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { gateway, type LanguageModel } from 'ai'
import { eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { orgSettings } from '@/db/schema'
import { activeConsent } from '@/server/patients'

export type LlmProvider = {
  provider: 'anthropic' | 'google' | 'gateway'; modelId: string; model: LanguageModel
  /** Tried in order when the primary model is overloaded (503); each attempt still takes a quota slot. */
  fallbacks?: { modelId: string; model: LanguageModel }[]
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
    return { provider: 'google', modelId, model: google(modelId), fallbacks }
  }
  if (process.env.AI_ENABLED === 'true' && (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN)) {
    const modelId = 'anthropic/claude-sonnet-5.5'
    return { provider: 'gateway', modelId, model: gateway(modelId) }
  }
  return null
}

export type LlmStatus = { on: boolean; provider: LlmProvider['provider'] | null; model: string | null; label: string }

/** For UI: plain "AI-assisted reading: on/off" (no model or provider names). Optionally per org. */
export function llmStatus(orgFlagOn = true): LlmStatus {
  const p = llmProvider()
  if (!p) return { on: false, provider: null, model: null, label: 'AI-assisted reading: off' }
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
  return { provider, reason: null }
}
