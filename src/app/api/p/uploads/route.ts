// Patient or caregiver: start a chunked upload. Consent to keep papers is checked here and again at intake.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/server/http'
import { assertConsent } from '@/server/patients'
import { checkStart, startUpload } from '@/server/uploads/chunks'

export const POST = route({
  auth: 'patient',
  body: z.object({ fileName: z.string().min(1).max(200), totalSize: z.number().int().positive(), totalChunks: z.number().int().positive().max(5000), sha256: z.string().length(64) }),
}, async ({ session, db, body, audit }) => {
  await assertConsent(db, session.patientId, 'store')
  const ok = checkStart(body)
  if (!ok.ok) {
    await audit('document.upload_rejected', 'patient', session.patientId, { reason: ok.code, via: 'chunked_start' })
    return NextResponse.json({ error: { code: ok.code, message: ok.message } }, { status: ok.code === 'file_too_large' ? 413 : 400 })
  }
  const uploader = { kind: session.kind, id: session.caregiverId ?? session.patientId }
  const s = await startUpload(db, { orgId: session.orgId, patientId: session.patientId, uploader, intakeRoute: 'patient_link', ...body })
  await audit('upload.chunked_start', 'patient', session.patientId, { sessionId: s.id, size: body.totalSize, chunks: body.totalChunks })
  return s
})
