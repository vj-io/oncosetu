// Document-index payload for the signed-in patient / caregiver (encrypted in their browser before upload).
import { z } from 'zod'
import { route } from '@/server/http'
import { assertConsent } from '@/server/patients'
import { sharePayloadFor } from '@/server/shares/shares'

export const GET = route({ auth: 'patient', query: z.object({ scope: z.enum(['index', 'index_with_quotes']).default('index') }) }, async (ctx) => {
  await assertConsent(ctx.db, ctx.session.patientId, 'share')
  return sharePayloadFor(ctx.db, ctx.session.patientId, ctx.query.scope)
})
