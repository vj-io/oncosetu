// Document-index payload for a share created at the desk (staff on behalf of the patient). The browser encrypts it;
// the server only ever stores ciphertext (FR-PAS-02).
import { z } from 'zod'
import { route } from '@/server/http'
import { assertConsent, assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'
import { sharePayloadFor } from '@/server/shares/shares'

export const GET = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'], query: z.object({ scope: z.enum(['index', 'index_with_quotes']).default('index') }),
}, async (ctx) => {
  const id = patientIdParam(ctx)
  await assertPatientAccess(ctx, id)
  await assertConsent(ctx.db, id, 'share')
  const payload = await sharePayloadFor(ctx.db, id, ctx.query.scope)
  await ctx.audit('share.payload', 'patient', id, { scope: ctx.query.scope, snapshotId: payload.snapshotId })
  return payload
})
