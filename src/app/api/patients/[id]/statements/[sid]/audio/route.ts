// The patient's own recording behind a voice answer (FR-VOX-05), for the Records and Clinician roles. Audited; never cached.
import { and, eq } from 'drizzle-orm'
import { patientStatements } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'
import { readClip } from '@/server/voice/clips'

export const GET = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  const [st] = await ctx.db.select({ audioId: patientStatements.audioId }).from(patientStatements)
    .where(and(eq(patientStatements.id, patientIdParam(ctx, 'sid')), eq(patientStatements.patientId, patientId)))
  const clip = st?.audioId ? await readClip(ctx.db, patientId, st.audioId) : null
  if (!clip) throw new HttpError(404, 'not_found', 'Not found')
  await ctx.audit('statement.audio_played', 'patient', patientId, { statementId: patientIdParam(ctx, 'sid') })
  return new Response(new Uint8Array(clip.bytes), { headers: { 'content-type': clip.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
})
