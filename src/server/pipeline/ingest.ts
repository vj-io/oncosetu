// Intake (FR-ING-02/06/07/08, E-DOC-01/02/05/18/19): validate → hash → dedupe → safety scan → store encrypted →
// queue. Processing runs after the response (scheduleProcessing → process.ts), never inside the upload request.
import { after } from 'next/server'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents, encounters } from '@/db/schema'
import { writeAudit, type AuditDetails } from '@/server/audit'
import { now } from '@/server/clock'
import { encryptField, sha256Hex } from '@/server/crypto'
import { storeFile } from '@/server/files'
import { HttpError } from '@/server/http'
import { log } from '@/server/log'
import { assertConsent } from '@/server/patients'
import { dHash, hamming, hasEicar, MAX_FILE_BYTES, NEAR_DUP_HAMMING, scanPdf, sniffMime } from './safety'

export type IntakeRoute = 'desk' | 'bulk' | 'patient_link' | 'offline_sync' | 'email' | 'whatsapp'
export type DocStatus = (typeof documents.$inferSelect)['status']

export type IngestInput = {
  orgId: string
  patientId: string
  uploadedBy: { kind: 'staff' | 'patient' | 'caregiver'; id: string }
  intakeRoute: IntakeRoute
  clientFileId?: string | null
  encounterId?: string | null
  fileName: string
  /** Declared type; ignored — the bytes are sniffed. */
  mime?: string
  bytes: Uint8Array
  clientCapturedAt?: Date | null
  /** Route handlers pass ctx.audit so the actor's role is recorded; otherwise the uploader kind is used. */
  audit?: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}

export type IngestResult = {
  documentId: string
  status: DocStatus
  duplicateOf?: string
  nearDuplicateOf?: string
  /** Same clientFileId seen before (offline sync / retry): nothing new was stored. */
  idempotent?: boolean
}

export const QUARANTINE_SCAN_LABEL = 'signature check; full AV scan out of scope on serverless'

/** Must run inside withOrg(orgId). Throws HttpError for files that are refused (nothing stored). */
export async function ingestDocument(tx: Tx, input: IngestInput): Promise<IngestResult> {
  const { orgId, patientId, bytes } = input
  const audit = input.audit ?? ((action, targetType, targetId, details) =>
    writeAudit(tx, { orgId, actorId: input.uploadedBy.id, actorRole: input.uploadedBy.kind, action, targetType, targetId, details }).then(() => {}))
  await assertConsent(tx, patientId, 'store')
  if (input.encounterId) { // a visit of another patient (or org, via RLS) must not be linked to this upload
    const [enc] = await tx.select({ patientId: encounters.patientId }).from(encounters).where(eq(encounters.id, input.encounterId))
    if (enc?.patientId !== patientId) throw new HttpError(400, 'invalid_encounter', 'That visit does not belong to this patient')
  }

  // E-DOC-18: idempotent completion for retries / offline sync.
  if (input.clientFileId) {
    const [prev] = await tx.select({ id: documents.id, patientId: documents.patientId, status: documents.status, duplicateOf: documents.duplicateOf })
      .from(documents).where(eq(documents.clientFileId, input.clientFileId))
    if (prev) {
      if (prev.patientId !== patientId) throw new HttpError(409, 'client_file_id_conflict', 'This upload id was already used for another record')
      return { documentId: prev.id, status: prev.status, idempotent: true }
    }
  }

  if (!bytes.length) throw new HttpError(400, 'empty_file', 'The file is empty')
  if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, 'file_too_large', 'Files must be 4 MB or smaller')
  const mime = sniffMime(bytes)
  const eicar = hasEicar(bytes)
  if (!mime) {
    if (eicar) throw new HttpError(422, 'malware_signature', 'The file could not be accepted')
    throw new HttpError(415, 'unsupported_type', 'Upload a PDF, JPEG, PNG, WebP or HEIC file')
  }

  // E-DOC-01: exact duplicate for this patient → linked, not reprocessed.
  const sha256 = sha256Hex(bytes)
  const [dup] = await tx.select({ id: documents.id, status: documents.status }).from(documents)
    .where(and(eq(documents.patientId, patientId), eq(documents.sha256, sha256), ne(documents.attachState, 'detached')))
    .orderBy(documents.receivedAt).limit(1)
  if (dup) {
    await audit('document.duplicate_upload', 'document', dup.id, { intakeRoute: input.intakeRoute })
    return { documentId: dup.id, status: dup.status, duplicateOf: dup.id }
  }

  const receivedAt = await now(orgId)
  const active = mime === 'application/pdf' ? scanPdf(bytes) : []
  const quarantine = eicar || active.length > 0

  // E-DOC-02: perceptual hash for images; near-duplicate = Hamming ≤ 6 against this patient's images.
  let phash: string | null = null
  let nearDupOf: string | null = null
  if (!quarantine && mime !== 'application/pdf') {
    phash = await dHash(bytes).catch(() => null)
    if (phash) {
      const others = await tx.select({ id: documents.id, phash: documents.phash }).from(documents)
        .where(and(eq(documents.patientId, patientId), isNotNull(documents.phash), ne(documents.attachState, 'detached')))
      const best = others.map((o) => ({ id: o.id, d: hamming(phash!, o.phash!) })).sort((a, b) => a.d - b.d)[0]
      if (best && best.d <= NEAR_DUP_HAMMING) nearDupOf = best.id
    }
  }

  const flags: Record<string, unknown> = {}
  if (quarantine) flags.quarantine = { reasons: [...(eicar ? ['eicar_signature'] : []), ...active.map((n) => `pdf_${n}`)], scan: QUARANTINE_SCAN_LABEL }
  if (nearDupOf) flags.near_duplicate = { of: nearDupOf, method: 'dhash' }

  let row: { id: string; status: DocStatus }
  try {
    ;[row] = await tx.insert(documents).values({
      orgId, patientId, encounterId: input.encounterId ?? null, clientFileId: input.clientFileId ?? null, sha256, phash, nearDupOf,
      mime, sizeBytes: bytes.length, filenameEnc: input.fileName ? encryptField(input.fileName.slice(0, 200)) : null,
      intakeRoute: input.intakeRoute, uploadedByKind: input.uploadedBy.kind, uploadedById: input.uploadedBy.id, receivedAt,
      clientCapturedAt: input.clientCapturedAt ?? null, stage: 'received', status: quarantine ? 'quarantined' : 'queued',
      attachState: 'pending_decision', flags,
    }).returning({ id: documents.id, status: documents.status })
  } catch (e) {
    // Two concurrent retries with one clientFileId: the unique index decides; return the winner.
    if ((e as { code?: string; cause?: { code?: string } })?.cause?.code === '23505' || (e as { code?: string })?.code === '23505') {
      throw new HttpError(409, 'upload_in_progress', 'This upload is already being saved; retry shortly')
    }
    throw e
  }
  // E-DOC-05/19: the original is kept encrypted even when quarantined; it is never processed or served.
  await storeFile(tx, { orgId, patientId, documentId: row.id, kind: 'original', mime, bytes: Buffer.from(bytes) })

  const details: AuditDetails = { intakeRoute: input.intakeRoute, mime, sizeBytes: bytes.length }
  if (nearDupOf) details.nearDuplicateOf = nearDupOf
  await audit('document.upload', 'document', row.id, details)
  if (quarantine) await audit('document.quarantined', 'document', row.id, { reasons: (flags.quarantine as { reasons: string[] }).reasons })
  return { documentId: row.id, status: row.status, ...(nearDupOf ? { nearDuplicateOf: nearDupOf } : {}) }
}

/**
 * Runs the pipeline for a document after the current response (`after()`); outside a request (scripts) it starts
 * immediately. Safe to call repeatedly: the claim in process.ts lets exactly one runner work on a document.
 * `password` (FR-ING-07) lives only in this closure — never stored, never logged.
 */
export function scheduleProcessing(documentId: string, orgId: string, opts: { password?: string } = {}): void {
  const run = () => import('./process').then((m) => m.runDocument(documentId, orgId, opts))
    .catch((err) => log.error('pipeline.schedule_failed', { documentId, err }))
  try {
    after(run)
  } catch {
    void run()
  }
}
