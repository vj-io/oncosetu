// "Given to the hospital on <date>" — the patient/caregiver confirms the date, or staff record it (FR-REQ-03).
import { z } from 'zod'
import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { markSent } from '@/server/requests/requests'

export const POST = route({ auth: 'any', body: z.object({ sentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) }, async (ctx) =>
  markSent(ctx, patientIdParam(ctx), ctx.body.sentOn))
