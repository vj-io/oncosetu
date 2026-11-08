// One entry point for every upload (portal, desk, chunked): a plain file goes straight to intake; a ZIP is opened safely,
// DICOM instances are grouped into studies (one document per study), every other entry is its own document, and whatever
// cannot be accepted is listed with a plain reason instead of failing the whole upload.
import type { Tx } from '@/db'
import { inBacklogOrder } from '@/core/backlog'
import { MAX_ZIP_BYTES } from '@/core/limits'
import { writeAudit } from '@/server/audit'
import { HttpError } from '@/server/http'
import { ingestDocument, type IngestInput, type IngestResult } from './ingest'
import { sniffFile } from './filetypes'
import { bundleInstances } from './study'
import { groupDicom, planZip, type Skipped } from './zip'

/** Why intake refuses a file (safety or format), as codes the Safety events page understands. Anything else is a real error. */
const REJECTION_CODES = new Set(['unsupported_type', 'file_too_large', 'malware_signature', 'zip_not_expanded', 'empty_file',
  'zip_too_large', 'zip_unreadable', 'zip_too_many_files', 'zip_too_big_unpacked', 'zip_bomb', 'zip_empty', 'zip_nothing_accepted'])

export type Rejection = { status: number; code: string; message: string }
/** `rejected` is set when nothing could be accepted. It is RETURNED, not thrown, so the audit row commits with the request. */
export type UploadResult = { documents: IngestResult[]; skipped: Skipped[]; expandedZip: boolean; rejected?: Rejection }

/** One audit row per refused upload (or refused ZIP entry): the reason code and route only, never the file name or content. */
async function auditRejected(tx: Tx, input: IngestInput, reason: string, count = 1) {
  const details = { reason, via: input.intakeRoute, ...(count > 1 ? { count } : {}) }
  if (input.audit) await input.audit('document.upload_rejected', 'patient', input.patientId, details)
  else await writeAudit(tx, { orgId: input.orgId, actorId: input.uploadedBy.id, actorRole: input.uploadedBy.kind, action: 'document.upload_rejected', targetType: 'patient', targetId: input.patientId, details })
}

const toRejection = (e: HttpError): Rejection => ({ status: e.status, code: e.code, message: e.message })

export async function ingestUpload(tx: Tx, input: IngestInput): Promise<UploadResult> {
  const sn = sniffFile(input.bytes, input.fileName)
  if (sn?.kind !== 'zip') {
    try {
      return { documents: [await ingestDocument(tx, input)], skipped: [], expandedZip: false }
    } catch (e) {
      if (e instanceof HttpError && REJECTION_CODES.has(e.code)) { await auditRejected(tx, input, e.code); return { documents: [], skipped: [], expandedZip: false, rejected: toRejection(e) } }
      throw e
    }
  }

  const plan = planZip(input.bytes)
  if (!plan.ok) {
    await auditRejected(tx, input, plan.code)
    return { documents: [], skipped: [], expandedZip: true, rejected: { status: plan.code === 'zip_too_large' ? 413 : 422, code: plan.code, message: plan.message } }
  }
  // Entries refused for safety (path tricks, a ZIP inside a ZIP) are reported once per reason.
  const refused = new Map<string, number>()
  for (const s of plan.skipped) if (s.code) refused.set(s.code, (refused.get(s.code) ?? 0) + 1)
  for (const [code, n] of refused) await auditRejected(tx, input, code, n)
  const skipped = [...plan.skipped]
  const documents: IngestResult[] = []
  const { studies, others } = groupDicom(plan.entries)
  const one = async (over: Partial<IngestInput>, label: string) => {
    try { documents.push(await ingestDocument(tx, { ...input, clientFileId: null, ...over })) } catch (e) {
      if (e instanceof HttpError && REJECTION_CODES.has(e.code)) await auditRejected(tx, input, e.code)
      if (e instanceof HttpError) skipped.push({ name: label, reason: e.status === 415 ? 'file type not accepted' : e.status === 413 ? 'file too large' : e.status === 422 ? 'file refused by the safety check' : e.message })
      else throw e
    }
  }
  for (const s of studies) {
    const first = [...s.instances].sort((a, b) => (a.meta.instanceNumber ?? 0) - (b.meta.instanceNumber ?? 0))[0].meta
    if (s.instances.length === 1) { await one({ fileName: s.instances[0].entry.base, bytes: s.instances[0].entry.data }, s.instances[0].entry.name); continue }
    const files = Object.fromEntries(s.instances.map((i, n) => [`${String(n + 1).padStart(4, '0')}-${i.entry.base.replace(/[^\w.-]/g, '_')}`, i.entry.data]))
    const imaging = { ...first, modalityLabel: s.label, studyLabel: s.label, modalities: s.modalities, instances: s.instances.length, frames: s.instances.length }
    await one({ fileName: `${s.label} (${s.instances.length} images)`, bytes: bundleInstances(files), bundle: { imaging }, maxBytes: MAX_ZIP_BYTES }, `${s.label} study`)
  }
  for (const e of inBacklogOrder(others, (x) => x.base)) await one({ fileName: e.base, bytes: e.data }, e.name) // FR-ONB-01: processed in this order
  if (!documents.length && skipped.length) {
    await auditRejected(tx, input, 'zip_nothing_accepted')
    return { documents, skipped, expandedZip: true, rejected: { status: 422, code: 'zip_nothing_accepted', message: `Nothing in the ZIP could be accepted: ${[...new Set(skipped.map((s) => s.reason))].join('; ')}` } }
  }
  return { documents, skipped, expandedZip: true }
}
