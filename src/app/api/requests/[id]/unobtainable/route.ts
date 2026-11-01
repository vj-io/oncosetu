// The hospital cannot provide the records: request → unobtainable, its open items → unobtainable with the reason (E-RAD-02).
import { z } from 'zod'
import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { markRequestUnobtainable } from '@/server/requests/requests'

export const POST = route({ auth: 'any', body: z.object({ reason: z.string().trim().min(1).max(500) }) }, async (ctx) =>
  markRequestUnobtainable(ctx, patientIdParam(ctx), ctx.body.reason))
