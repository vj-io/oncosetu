// A desk audio note, played back on the documents screen. Records and Clinician roles only (the desk records, it does not
// listen back), like the voice answers behind statements. Audited; never cached.
import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'
import { readClip } from '@/server/voice/clips'

export const GET = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  const clipId = patientIdParam(ctx, 'clipId')
  const clip = await readClip(ctx.db, patientId, clipId)
  if (!clip) throw new HttpError(404, 'not_found', 'Not found')
  await ctx.audit('encounter.audio_note_played', 'patient', patientId, { clipId })
  return new Response(new Uint8Array(clip.bytes), { headers: { 'content-type': clip.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
})
