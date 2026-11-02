// Vercel Cron (vercel.json, daily): proves the configured LLM answers from the deployment itself, using ONE call from
// the shared free-tier budget. Synthetic prompt only — no patient data. The outcome is the llm_calls row it settles
// (read with `npx tsx --env-file=.env.local scripts/llm-health-report.ts`). Vercel sends `Authorization: Bearer $CRON_SECRET`.
import { generateText } from 'ai'
import { timingSafeEqualStr } from '@/server/crypto'
import { llmProvider } from '@/server/ai/provider'
import { reserveLlmCall, settleLlmCall } from '@/server/ai/quota'
import { HttpError, route } from '@/server/http'

export const maxDuration = 60

export const GET = route({ auth: 'public' }, async ({ req, log }) => {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new HttpError(503, 'not_configured', 'Cron is not configured')
  if (!timingSafeEqualStr(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthenticated', 'Not allowed')
  const p = llmProvider()
  if (!p) return { ok: false, reason: 'no_provider' }
  const slot = await reserveLlmCall(p.provider, p.modelId)
  if ('denied' in slot) return { ok: false, reason: `quota_${slot.denied}`, model: p.modelId }
  const t0 = Date.now()
  try {
    const r = await generateText({ model: p.model, prompt: 'Reply with the single word: ready', maxRetries: 0, maxOutputTokens: 20, abortSignal: AbortSignal.timeout(30_000) })
    const ok = /ready/i.test(r.text)
    await settleLlmCall(slot.id, ok ? 'ok' : 'schema_error')
    log.info('llm.health', { ok, model: p.modelId, latencyMs: Date.now() - t0, region: process.env.VERCEL_REGION ?? 'local' })
    return { ok, model: p.modelId, provider: p.provider, latencyMs: Date.now() - t0, region: process.env.VERCEL_REGION ?? 'local' }
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    await settleLlmCall(slot.id, status === 429 ? 'rate_limited' : 'provider_error')
    return { ok: false, model: p.modelId, reason: status ? `http_${status}` : 'error', latencyMs: Date.now() - t0 }
  }
})
