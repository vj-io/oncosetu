// Staff: start a chunked upload (files over the 4.5 MB request limit). Body: file name, size, chunk count, SHA-256.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'
import { checkStart, startUpload } from '@/server/uploads/chunks'

export const POST = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'],
  body: z.object({ fileName: z.string().min(1).max(200), totalSize: z.number().int().positive(), totalChunks: z.number().int().positive().max(5000), sha256: z.string().length(64), encounterId: z.uuid().optional() }),
}, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  const ok = checkStart(ctx.body)
  if (!ok.ok) {
    await ctx.audit('document.upload_rejected', 'patient', patientId, { reason: ok.code, via: 'chunked_start' })
    return NextResponse.json({ error: { code: ok.code, message: ok.message } }, { status: ok.code === 'file_too_large' ? 413 : 400 })
  }
  const s = await startUpload(ctx.db, { orgId: ctx.session.orgId, patientId, uploader: { kind: 'staff', id: ctx.session.staffId }, intakeRoute: 'bulk', ...ctx.body })
  await ctx.audit('upload.chunked_start', 'patient', patientId, { sessionId: s.id, size: ctx.body.totalSize, chunks: ctx.body.totalChunks })
  return s
})
