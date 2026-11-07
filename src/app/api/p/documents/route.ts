// Patient / caregiver upload (FR-ING-03): OTP session only. The Pipeline's ingest checks consent `store` on use,
// sniffs the type, de-duplicates, stores the file encrypted and writes the audit rows (we pass ctx.audit so the actor's role is kept).
import { NextResponse } from 'next/server'
import { HttpError, route } from '@/server/http'
import { scheduleProcessing } from '@/server/portal/pipeline'
import { ingestUpload } from '@/server/pipeline/upload'
import { ONE_SHOT_BYTES } from '@/core/limits'

const MAX_BYTES = ONE_SHOT_BYTES // bigger files arrive in chunks (/api/p/uploads); a request body is capped at 4.5 MB

export const POST = route({ auth: 'patient', form: true }, async ({ session, db, form, audit }) => {
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, 'invalid_request', 'A file is required')
  if (file.size > MAX_BYTES) throw new HttpError(413, 'too_large', 'File is too large')
  const rawId = form.get('clientFileId')
  const clientFileId = typeof rawId === 'string' && /^[\w-]{8,100}$/.test(rawId) ? rawId : undefined

  const up = await ingestUpload(db, {
    orgId: session.orgId, patientId: session.patientId,
    uploadedBy: { kind: session.kind, id: session.caregiverId ?? session.patientId },
    intakeRoute: 'patient_link', clientFileId, fileName: file.name || 'upload', mime: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()), audit,
  })
  if (up.rejected) return NextResponse.json({ error: { code: up.rejected.code, message: up.rejected.message } }, { status: up.rejected.status }) // audited above; returned so it commits
  for (const r of up.documents) if (!r.duplicateOf && r.status === 'queued') scheduleProcessing(r.documentId, session.orgId) // after the response
  return { ok: true, duplicate: up.documents.length > 0 && up.documents.every((r) => !!r.duplicateOf), skipped: up.skipped }
})
