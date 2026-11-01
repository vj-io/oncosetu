import { z } from 'zod'
import { HttpError, route } from '@/server/http'
import { setRuleMode } from '@/server/admin/rules'
import { recomputeAffected } from '@/server/admin/radar-recompute'
import { zUuid } from '@/server/admin/schemas'

// FR-RAD-05: "Mark clinician-reviewed → production" needs the reviewing clinician and an explicit confirmation.
export const POST = route({
  auth: 'staff', roles: ['org_admin'],
  body: z.object({ mode: z.enum(['production', 'shadow']), reviewerId: zUuid.optional(), confirm: z.boolean().optional() }),
}, async (ctx) => {
  if (ctx.body.mode === 'production' && ctx.body.confirm !== true) throw new HttpError(400, 'confirmation_required', 'Confirm that a clinician reviewed this rule')
  const r = await setRuleMode(ctx, String(ctx.params.ruleId), ctx.body.mode, ctx.body.reviewerId)
  await recomputeAffected(ctx.db, ctx.session.orgId, r.patientIds)
  return { mode: r.mode, itemsFlipped: r.itemsFlipped }
})
