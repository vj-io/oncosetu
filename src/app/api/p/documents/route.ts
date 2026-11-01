// Patient / caregiver upload (FR-ING-03): OTP session only. The Pipeline's ingest checks consent `store` on use,
// sniffs the type, de-duplicates, stores the file encrypted and writes the audit rows (we pass ctx.audit so the actor's role is kept).
import { HttpError, route } from '@/server/http'
import { ingestDocument, scheduleProcessing } from '@/server/portal/pipeline'

const MAX_BYTES = 4 * 1024 * 1024 // the client re-encodes photos to JPEG ≤ 2400px; Vercel's body limit is 4.5 MB

export const POST = route({ auth: 'patient', form: true }, async ({ session, db, form, audit }) => {
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, 'invalid_request', 'A file is required')
  if (file.size > MAX_BYTES) throw new HttpError(413, 'too_large', 'File is too large')
  const rawId = form.get('clientFileId')
  const clientFileId = typeof rawId === 'string' && /^[\w-]{8,100}$/.test(rawId) ? rawId : undefined

  const res = await ingestDocument(db, {
    orgId: session.orgId, patientId: session.patientId,
    uploadedBy: { kind: session.kind, id: session.caregiverId ?? session.patientId },
    intakeRoute: 'patient_link', clientFileId, fileName: file.name || 'upload', mime: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()), audit,
  })
  if (!res.duplicateOf && res.status !== 'quarantined') scheduleProcessing(res.documentId, session.orgId) // after the response
  // Nothing about the document's content, class or safety result goes back to the patient (FR-CON-07).
  return { ok: true, duplicate: !!res.duplicateOf }
})
