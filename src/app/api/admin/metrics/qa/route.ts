import { z } from 'zod'
import { route } from '@/server/http'
import { recordQaReview } from '@/server/admin/qa'
import { zUuid } from '@/server/admin/schemas'

// FR-VER-04: a clinician other than the verifier records agree / disagree on a sampled item.
export const POST = route({
  auth: 'staff', roles: ['clinician'], body: z.object({ verificationId: zUuid, outcome: z.enum(['agree', 'disagree']) }),
}, (ctx) => recordQaReview(ctx, ctx.body.verificationId, ctx.body.outcome))
