// Staff chunked upload: GET = which chunks are stored (resume), POST = store one chunk (multipart: idx, chunk).
import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'
import { putChunk, uploadStatus } from '@/server/uploads/chunks'

const roles = ['desk', 'records', 'clinician'] as const

export const GET = route({ auth: 'staff', roles }, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  return uploadStatus(ctx.db, patientIdParam(ctx, 'sid'), patientId, { kind: 'staff', id: ctx.session.staffId })
})

export const POST = route({ auth: 'staff', roles, form: true, maxBytes: 4.4 * 1024 * 1024 }, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  const chunk = ctx.form.get('chunk'), idx = Number(ctx.form.get('idx'))
  if (!(chunk instanceof File) || !Number.isInteger(idx)) throw new HttpError(400, 'invalid_request', 'A chunk and its number are required')
  return putChunk(ctx.db, { sessionId: patientIdParam(ctx, 'sid'), patientId, uploader: { kind: 'staff', id: ctx.session.staffId }, orgId: ctx.session.orgId, idx, bytes: new Uint8Array(await chunk.arrayBuffer()) })
})
