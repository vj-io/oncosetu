// J7: the patient or caregiver says something is wrong with one of their documents. Reason code only (no free text).
import { z } from 'zod'
import { route } from '@/server/http'
import { idParam } from '@/server/ledger/verify'
import { DISPUTE_REASONS, disputeDocument } from '@/server/portal/dispute'

export const POST = route({ auth: 'patient', body: z.object({ reason: z.enum(DISPUTE_REASONS) }) }, (ctx) =>
  disputeDocument(ctx, idParam(ctx), ctx.body.reason))
