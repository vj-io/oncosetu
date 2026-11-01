// Human transitions on a completeness item (FR-RAD-03): request, receive, confirm closure, not a match,
// unobtainable (reason), dismiss (reason), reopen. Confirming closure settles any linked request.
import { z } from 'zod'
import { route } from '@/server/http'
import { transitionItem } from '@/server/radar-ui/completeness'
import { patientIdParam } from '@/server/registration/http'

const Body = z.object({
  action: z.enum(['request', 'receive', 'confirm', 'reject_match', 'unobtainable', 'dismiss', 'reopen']),
  reason: z.string().trim().max(500).optional(),
  documentId: z.uuid().optional(),
})

export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body: Body }, async (ctx) =>
  transitionItem(ctx, patientIdParam(ctx), ctx.body))
