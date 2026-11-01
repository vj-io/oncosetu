import { z } from 'zod'
import { route } from '@/server/http'
import { saveSettings } from '@/server/admin/ops'

// FR-ADM-04 + feature flags. Retention below 3 years is refused (§10.5).
export const POST = route({
  auth: 'staff', roles: ['org_admin'],
  body: z.object({
    flags: z.object({ voice: z.boolean(), tts: z.boolean(), ai_extraction: z.boolean() }).optional(),
    retentionDays: z.number().int().max(36_500).optional(),
  }),
}, async (ctx) => {
  await saveSettings(ctx, ctx.body)
  return { ok: true }
})
