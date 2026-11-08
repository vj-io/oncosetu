import { z } from 'zod'
import { route } from '@/server/http'
import { LLM_BUDGET_MAX, saveSettings } from '@/server/admin/ops'

// FR-ADM-04 + feature flags + the per-org daily LLM budget (PRD §9.6). Retention below 3 years is refused (§10.5).
export const POST = route({
  auth: 'staff', roles: ['org_admin'],
  body: z.object({
    flags: z.object({ voice: z.boolean(), tts: z.boolean(), ai_extraction: z.boolean() }).optional(),
    retentionDays: z.number().int().max(36_500).optional(),
    llmBudget: z.object({ calls: z.number().int().min(0).max(LLM_BUDGET_MAX.calls), tokens: z.number().int().min(0).max(LLM_BUDGET_MAX.tokens) }).optional(),
  }),
}, async (ctx) => {
  await saveSettings(ctx, ctx.body)
  return { ok: true }
})
