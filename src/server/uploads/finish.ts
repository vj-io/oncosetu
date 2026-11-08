// Finishing a chunked upload: join, verify, then the same intake as any other upload (ZIPs are opened, studies grouped).
import { NextResponse } from 'next/server'
import type { Tx } from '@/db'
import type { AuditDetails } from '../audit'
import { decryptField } from '../crypto'
import { scheduleBatch } from '../pipeline/ingest'
import { ingestUpload } from '../pipeline/upload'
import { assemble, closeSession } from './chunks'

export async function finishUpload(a: {
  db: Tx; orgId: string; patientId: string; uploader: { kind: 'staff' | 'patient' | 'caregiver'; id: string }; sessionId: string
  audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}) {
  const { bytes, session } = await assemble(a.db, a.sessionId, a.patientId, a.uploader)
  const up = await ingestUpload(a.db, {
    orgId: a.orgId, patientId: a.patientId, uploadedBy: a.uploader, intakeRoute: session.intakeRoute as 'desk' | 'bulk' | 'patient_link',
    encounterId: session.encounterId, fileName: session.fileNameEnc ? decryptField(session.fileNameEnc) : 'upload', bytes, audit: a.audit,
  })
  await closeSession(a.db, session.id, up.rejected ? 'aborted' : 'done') // the chunks are removed either way
  if (up.rejected) return NextResponse.json({ error: { code: up.rejected.code, message: up.rejected.message } }, { status: up.rejected.status }) // audited in intake; returned so it commits
  await a.audit('upload.chunked_finish', 'patient', a.patientId, { documents: up.documents.length, skipped: up.skipped.length, zip: up.expandedZip })
  scheduleBatch(up.documents.filter((d) => d.status === 'queued' && !d.duplicateOf && !d.idempotent).map((d) => d.documentId), a.orgId) // FR-ONB-01 order
  return { ok: true, documents: up.documents.length, duplicate: up.documents.length > 0 && up.documents.every((d) => !!d.duplicateOf), skipped: up.skipped }
}
