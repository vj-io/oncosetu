// Staff: start a chunked upload (files over the 4.5 MB request limit). Body: file name, size, chunk count, SHA-256.
// The capture app's offline queue sends every page this way (small chunks, resumable after a reload) with the same
// clientFileId / intakeRoute / clientCapturedAt fields and x-device-id header as the one-shot documents route.
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { documents } from '@/db/schema'
import { assertDeviceActive } from '@/server/devices/check'
import { route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'
import { checkStart, startUpload } from '@/server/uploads/chunks'

export const POST = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'],
  body: z.object({
    fileName: z.string().min(1).max(200), totalSize: z.number().int().positive(), totalChunks: z.number().int().positive().max(5000), sha256: z.string().length(64), encounterId: z.uuid().optional(),
    clientFileId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
    intakeRoute: z.enum(['bulk', 'desk', 'offline_sync']).default('bulk'),
    clientCapturedAt: z.iso.datetime({ offset: true }).optional(),
  }),
}, async (ctx) => {
  await assertDeviceActive(ctx.db, ctx.session.orgId, ctx.req.headers.get('x-device-id'))
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  if (ctx.body.clientFileId) { // E-DOC-18: finished before, but the answer was lost. Nothing to send again.
    const [d] = await ctx.db.select({ id: documents.id }).from(documents)
      .where(and(eq(documents.patientId, patientId), eq(documents.clientFileId, ctx.body.clientFileId))).limit(1)
    if (d) return { id: null, done: true, documentId: d.id }
  }
  const ok = checkStart(ctx.body)
  if (!ok.ok) {
    await ctx.audit('document.upload_rejected', 'patient', patientId, { reason: ok.code, via: 'chunked_start' })
    return NextResponse.json({ error: { code: ok.code, message: ok.message } }, { status: ok.code === 'file_too_large' ? 413 : 400 })
  }
  const { clientCapturedAt, ...rest } = ctx.body
  const s = await startUpload(ctx.db, { orgId: ctx.session.orgId, patientId, uploader: { kind: 'staff', id: ctx.session.staffId }, ...rest, clientCapturedAt: clientCapturedAt ? new Date(clientCapturedAt) : null })
  await ctx.audit('upload.chunked_start', 'patient', patientId, { sessionId: s.id, size: ctx.body.totalSize, chunks: ctx.body.totalChunks })
  return s
})
