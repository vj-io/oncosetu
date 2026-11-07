import { HttpError, route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { putChunk, uploadStatus } from '@/server/uploads/chunks'

const who = (s: { kind: 'patient' | 'caregiver'; caregiverId?: string | null; patientId: string }) => ({ kind: s.kind, id: s.caregiverId ?? s.patientId })

/** Patient chunked upload: GET = chunks already stored (resume), POST = store one chunk (multipart: idx, chunk). */
export const GET = route({ auth: 'patient' }, async (ctx) => uploadStatus(ctx.db, patientIdParam(ctx, 'sid'), ctx.session.patientId, who(ctx.session)))

export const POST = route({ auth: 'patient', form: true, maxBytes: 4.4 * 1024 * 1024 }, async (ctx) => {
  const chunk = ctx.form.get('chunk'), idx = Number(ctx.form.get('idx'))
  if (!(chunk instanceof File) || !Number.isInteger(idx)) throw new HttpError(400, 'invalid_request', 'A chunk and its number are required')
  return putChunk(ctx.db, { sessionId: patientIdParam(ctx, 'sid'), patientId: ctx.session.patientId, uploader: who(ctx.session), orgId: ctx.session.orgId, idx, bytes: new Uint8Array(await chunk.arrayBuffer()) })
})
