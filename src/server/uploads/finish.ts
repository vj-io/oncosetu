// Finishing a chunked upload: join, verify, then the same intake as any other upload (ZIPs are opened, studies grouped).
import type { Tx } from '@/db'
import type { AuditDetails } from '../audit'
import { decryptField } from '../crypto'
import { scheduleProcessing } from '../pipeline/ingest'
import { ingestUpload } from '../pipeline/upload'
import { assemble, closeSession } from './chunks'

export async function finishUpload(a: {
  db: Tx; orgId: string; patientId: string; uploader: { kind: 'staff' | 'patient' | 'caregiver'; id: string }; sessionId: string
  audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}) {
  const { bytes, session } = await assemble(a.db, a.sessionId, a.patientId, a.uploader)
  const res = await ingestUpload(a.db, {
    orgId: a.orgId, patientId: a.patientId, uploadedBy: a.uploader, intakeRoute: session.intakeRoute as 'desk' | 'bulk' | 'patient_link',
    encounterId: session.encounterId, fileName: session.fileNameEnc ? decryptField(session.fileNameEnc) : 'upload', bytes, audit: a.audit,
  })
  await closeSession(a.db, session.id, 'done')
  await a.audit('upload.chunked_finish', 'patient', a.patientId, { documents: res.documents.length, skipped: res.skipped.length, zip: res.expandedZip })
  for (const d of res.documents) if (d.status === 'queued' && !d.duplicateOf && !d.idempotent) scheduleProcessing(d.documentId, a.orgId)
  return { ok: true, documents: res.documents.length, duplicate: res.documents.length > 0 && res.documents.every((d) => !!d.duplicateOf), skipped: res.skipped }
}
