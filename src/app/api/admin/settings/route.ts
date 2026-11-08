import { z } from 'zod'
import { route } from '@/server/http'
import { saveSettings } from '@/server/admin/ops'
import { QUESTION_IDS, type QuestionId } from '@/server/portal/visit-model'

// FR-ADM-04 + feature flags. Retention below 3 years is refused (§10.5).
// questions (FR-VOX-01): all five, each once, in the order asked, at least one switched on.
export const POST = route({
  auth: 'staff', roles: ['org_admin'],
  body: z.object({
    flags: z.object({ voice: z.boolean(), tts: z.boolean(), ai_extraction: z.boolean(), voice_shadow: z.boolean().optional() }).optional(),
    questions: z.array(z.object({ id: z.enum(QUESTION_IDS as [QuestionId, ...QuestionId[]]), on: z.boolean() })).length(QUESTION_IDS.length)
      .refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, 'each question once')
      .refine((qs) => qs.some((q) => q.on), 'at least one question on')
      .optional(),
    retentionDays: z.number().int().max(36_500).optional(),
  }),
}, async (ctx) => {
  await saveSettings(ctx, ctx.body)
  return { ok: true }
})
