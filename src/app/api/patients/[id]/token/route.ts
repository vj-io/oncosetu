import { z } from 'zod'
import { route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { accession, patientIdParam } from '@/server/registration/http'
import { groupToken } from '@/server/registration/logic'
import { reissueToken, revokeToken } from '@/server/registration/token'

// Card lost or stolen (FR-ID-08, E-ID-07). "reissue" (default) retires the old token and returns the new one ONCE;
// "revoke" only switches the old one off. Either way the old card answers "revoked".
export const POST = route({
  auth: 'staff', roles: ['desk', 'records'], body: z.object({ action: z.enum(['reissue', 'revoke']).default('reissue') }),
}, async (ctx) => {
  const id = patientIdParam(ctx)
  await assertPatientAccess(ctx, id) // a new card is a way into the record: desk only after verifying the patient
  if (ctx.body.action === 'revoke') {
    await revokeToken(ctx.db, ctx.audit, id)
    return { ok: true, revoked: true }
  }
  const r = await reissueToken(ctx.db, ctx.audit, id)
  return { ok: true, token: r!.token, tokenGrouped: groupToken(r!.token), accession: accession(id), cardUrl: `/patients/${id}/card` }
})
