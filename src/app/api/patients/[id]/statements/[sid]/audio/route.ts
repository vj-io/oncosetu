// The patient's own recording behind a voice answer (FR-VOX-05), for the Records and Clinician roles. Audited; never cached.
// ?clip=<id>: a voice shadow-mode recording kept beside this (typed) answer (FR-VOX-03); it must belong to this statement.
import { and, eq } from 'drizzle-orm'
import { patientStatements, voiceClips } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'
import { readClip } from '@/server/voice/clips'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) => {
  const patientId = patientIdParam(ctx)
  const statementId = patientIdParam(ctx, 'sid')
  await assertPatientAccess(ctx, patientId)
  const shadow = ctx.req.nextUrl.searchParams.get('clip')
  let clipId: string | null = null
  if (shadow !== null) {
    if (!UUID.test(shadow)) throw new HttpError(404, 'not_found', 'Not found')
    const [c] = await ctx.db.select({ id: voiceClips.id }).from(voiceClips).where(and(eq(voiceClips.id, shadow), eq(voiceClips.statementId, statementId), eq(voiceClips.patientId, patientId)))
    clipId = c?.id ?? null
  } else {
    const [st] = await ctx.db.select({ audioId: patientStatements.audioId }).from(patientStatements)
      .where(and(eq(patientStatements.id, statementId), eq(patientStatements.patientId, patientId)))
    clipId = st?.audioId ?? null
  }
  const clip = clipId ? await readClip(ctx.db, patientId, clipId) : null
  if (!clip) throw new HttpError(404, 'not_found', 'Not found')
  await ctx.audit('statement.audio_played', 'patient', patientId, { statementId, ...(shadow !== null ? { clipId, shadow: true } : {}) })
  return new Response(new Uint8Array(clip.bytes), { headers: { 'content-type': clip.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
})
