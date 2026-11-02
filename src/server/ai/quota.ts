// Shared LLM call budget (drizzle/0011_llm_quota.sql). One free-tier Gemini key serves every org and every serverless
// instance, so the limit lives in Postgres: llm_reserve() serialises on an advisory lock and refuses once the
// per-minute or per-day budget is spent, or while a provider 429 cooldown is running. A refused call is not an error:
// the pipeline falls back to rule-based extraction behind the same evidence gate.
// Runs on sideDb: it is called outside request transactions and must commit even if the caller later fails (POOL RULE).
import { sql } from 'drizzle-orm'
import { sideDb } from '@/db'

const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d)

/** Defaults sit below Gemini's free-tier limits; override with LLM_RPM / LLM_RPD / LLM_COOLDOWN_S. */
export function llmLimits() {
  return { rpm: int(process.env.LLM_RPM, 8), rpd: int(process.env.LLM_RPD, 200), cooldownS: int(process.env.LLM_COOLDOWN_S, 60) }
}

export type QuotaDenial = 'rpm' | 'rpd' | 'cooldown'
export type Reservation = { id: number } | { denied: QuotaDenial }
export type LlmOutcome = 'ok' | 'schema_error' | 'provider_error' | 'rate_limited'

export async function reserveLlmCall(provider: string, model: string): Promise<Reservation> {
  const l = llmLimits()
  const rows = await sideDb.execute<{ call_id: string | null; reason: QuotaDenial | null }>(
    sql`select * from llm_reserve(${provider}, ${model}, ${l.rpm}, ${l.rpd}, ${l.cooldownS})`)
  const r = rows[0]
  return r?.call_id ? { id: Number(r.call_id) } : { denied: r?.reason ?? 'rpm' }
}

/** Offline tools (eval) wait for a slot instead of falling back; never used on request paths. */
export async function reserveLlmCallWaiting(provider: string, model: string, maxWaitMs = 10 * 60_000): Promise<Reservation> {
  const until = Date.now() + maxWaitMs
  for (;;) {
    const r = await reserveLlmCall(provider, model)
    if ('id' in r || r.denied === 'rpd' || Date.now() > until) return r
    await new Promise((res) => setTimeout(res, r.denied === 'cooldown' ? llmLimits().cooldownS * 1000 : 7_500))
  }
}

export async function settleLlmCall(id: number, outcome: LlmOutcome): Promise<void> {
  await sideDb.execute(sql`select llm_settle(${id}, ${outcome})`).catch(() => undefined) // bookkeeping only; never fails the caller
}

export async function llmUsage(): Promise<{ lastMinute: number; today: number; cooldownUntil: Date | null; limits: ReturnType<typeof llmLimits> }> {
  const limits = llmLimits()
  const [r] = await sideDb.execute<{ last_minute: number; today: number; cooldown_until: string | null }>(sql`select * from llm_usage(${limits.cooldownS})`)
  return { lastMinute: r?.last_minute ?? 0, today: r?.today ?? 0, cooldownUntil: r?.cooldown_until ? new Date(r.cooldown_until) : null, limits }
}
