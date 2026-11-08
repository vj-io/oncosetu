// Desk audio note of an encounter, sent by the capture app's queue (V05-E2E-01). Multipart: `file` (audio), `clientFileId`
// (the device's UUIDv7, becomes the clip id: idempotent), `encounterId`, `seconds`. Stored encrypted in voice_clips (0020).
// The desk may record; only Records and Clinicians play notes back (GET [clipId]).
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { encounters } from '@/db/schema'
import { assertDeviceActive } from '@/server/devices/check'
import { HttpError, route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'
import { storeDeskNote } from '@/server/voice/clips'

const MAX_NOTE_BYTES = 3.5 * 1024 * 1024

const meta = z.object({ clientFileId: z.uuidv7(), encounterId: z.uuid(), seconds: z.coerce.number().int().min(0).max(3600) })

export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'], form: true }, async (ctx) => {
  await assertDeviceActive(ctx.db, ctx.session.orgId, ctx.req.headers.get('x-device-id'))
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  const file = ctx.form.get('file')
  if (!(file instanceof File) || !file.size) throw new HttpError(400, 'file_required', 'Attach the recording')
  if (!/^audio\//.test(file.type)) throw new HttpError(415, 'unsupported_type', 'Only an audio recording can be attached here')
  if (file.size > MAX_NOTE_BYTES) throw new HttpError(413, 'file_too_large', 'The recording is too long')
  const m = meta.parse({ clientFileId: ctx.form.get('clientFileId'), encounterId: ctx.form.get('encounterId'), seconds: ctx.form.get('seconds') ?? 0 })
  const [enc] = await ctx.db.select({ id: encounters.id }).from(encounters).where(and(eq(encounters.id, m.encounterId), eq(encounters.patientId, patientId)))
  if (!enc) throw new HttpError(404, 'not_found', 'Not found')
  const out = await storeDeskNote(ctx.db, {
    id: m.clientFileId, orgId: ctx.session.orgId, patientId, encounterId: enc.id, by: { kind: 'staff', id: ctx.session.staffId },
    bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, seconds: m.seconds,
  })
  if (!out) throw new HttpError(409, 'conflict', 'This note id belongs to another record')
  if (out.created) await ctx.audit('encounter.audio_note_added', 'encounter', enc.id, { patientId, clipId: m.clientFileId, seconds: m.seconds })
  return { id: m.clientFileId, idempotent: !out.created }
})
