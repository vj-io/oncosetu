import { z } from 'zod'
import { route } from '@/server/http'
import { recordConsent, recordConsentSchema, withdrawConsentRoute } from '@/server/registration/consent'
import { patientIdParam } from '@/server/registration/http'

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('withdraw') }),
  recordConsentSchema.extend({ action: z.literal('record') }),
])

// Withdrawal is one action and takes effect on the next request; share links are revoked with it (FR-CON-04, J8).
export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'], body }, (ctx) => {
  const id = patientIdParam(ctx)
  return ctx.body.action === 'withdraw' ? withdrawConsentRoute(ctx, id) : recordConsent({ ...ctx, body: ctx.body }, id)
})
