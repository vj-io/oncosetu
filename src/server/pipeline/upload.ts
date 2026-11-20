// One entry point for every upload (portal, desk, chunked): a plain file goes straight to intake; a ZIP is opened safely,
// DICOM instances are grouped into studies (one document per study), every other entry is its own document, and whatever
// cannot be accepted is listed with a plain reason instead of failing the whole upload.
import type { Tx } from '@/db'
import { inBacklogOrder } from '@/core/backlog'
import { MAX_STUDY_BUNDLE_BYTES } from '@/core/limits'
import { writeAudit } from '@/server/audit'
import { HttpError } from '@/server/http'
import { ingestDocument, type IngestInput, type IngestResult } from './ingest'
import { sniffFile } from './filetypes'
import { isCompressedSyntax, studyLabel, type DicomMeta } from './dicom'
import { BundleWriter } from './study'
import { inspectZip, openEntries, ZipMismatch, type Skipped, type ZipEntry } from './zip'

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

  const plan = inspectZip(input.bytes)
  if (!plan.ok) {
    await auditRejected(tx, input, plan.code)
    return { documents: [], skipped: [], expandedZip: true, rejected: { status: plan.code === 'zip_too_large' ? 413 : 422, code: plan.code, message: plan.message } }
  }
  // Entries refused for safety (path tricks, a ZIP inside a ZIP) are reported once per reason.
  const skipped = [...plan.skipped]
  const refusedNested = { n: 0 }
  // Pass 1: open the ZIP a batch at a time and keep only what is small: each DICOM slice's header (the picture is let go), and any
  // other file as it is. A study of a few thousand slices is therefore never held in memory in full.
  type Head = { name: string; base: string; meta: DicomMeta; squeeze: boolean }
  const heads: Head[] = []
  const others: ZipEntry[] = []
  try {
    for (const e of openEntries(input.bytes, plan.take)) {
      const kind = sniffFile(e.data, e.base)?.kind
      if (kind === 'zip') { skipped.push({ name: e.name, reason: 'a ZIP inside a ZIP is not accepted', code: 'nested_archive' }); refusedNested.n++; continue }
      if (e.base.toUpperCase() === 'DICOMDIR') { skipped.push({ name: e.name, reason: 'DICOMDIR index (not needed, the images are read directly)' }); continue }
      const meta = kind === 'dicom' ? readDicomMeta(e.data) : null
      if (meta) heads.push({ name: e.name, base: e.base, meta, squeeze: !isCompressedSyntax(meta.transferSyntax) })
      else others.push(e) // a header that cannot be read goes through intake alone (and is held or refused there)
    }
  } catch (e) {
    if (!(e instanceof ZipMismatch)) throw e
    const code = e.message.includes('listing') ? 'zip_bomb' : 'zip_unreadable'
    await auditRejected(tx, input, code)
    return { documents: [], skipped: [], expandedZip: true, rejected: { status: 422, code, message: e.message } }
  }
  const refused = new Map<string, number>()
  for (const s of skipped) if (s.code) refused.set(s.code, (refused.get(s.code) ?? 0) + 1)
  for (const [code, n] of refused) await auditRejected(tx, input, code, n)

  const documents: IngestResult[] = []
  const one = async (over: Partial<IngestInput>, label: string) => {
    try { documents.push(await ingestDocument(tx, { ...input, clientFileId: null, ...over })) } catch (e) {
      if (e instanceof HttpError && REJECTION_CODES.has(e.code)) await auditRejected(tx, input, e.code)
      if (e instanceof HttpError) skipped.push({ name: label, reason: e.status === 415 ? 'file type not accepted' : e.status === 413 ? 'file too large' : e.status === 422 ? 'file refused by the safety check' : e.message })
      else throw e
    }
  }

  // Group the slices by StudyInstanceUID (one document per study) and put each study in reading order: series in the order they
  // appear, then instance number. Slice names carry that order, so the viewer can open slice N without opening the whole bundle.
  const groups = new Map<string, Head[]>()
  for (const h of heads) { const k = h.meta.studyUid ?? `single:${h.name}`; groups.set(k, [...(groups.get(k) ?? []), h]) }
  type Built = { heads: Head[]; rank: Map<string, number>; writer: BundleWriter | null; single: Uint8Array | null; tooBig: boolean }
  const built = new Map<string, Built>()
  const where = new Map<string, string>() // entry name to its group key
  for (const [k, hs] of groups) {
    const seriesOrder = new Map<string, number>()
    for (const h of hs) if (!seriesOrder.has(h.meta.seriesUid ?? '')) seriesOrder.set(h.meta.seriesUid ?? '', seriesOrder.size)
    const ordered = [...hs].sort((a, b) => seriesOrder.get(a.meta.seriesUid ?? '')! - seriesOrder.get(b.meta.seriesUid ?? '')! || (a.meta.instanceNumber ?? 0) - (b.meta.instanceNumber ?? 0) || (a.name < b.name ? -1 : 1))
    built.set(k, { heads: ordered, rank: new Map(ordered.map((h, i) => [h.name, i])), writer: hs.length > 1 ? new BundleWriter(MAX_STUDY_BUNDLE_BYTES) : null, single: null, tooBig: false })
    for (const h of hs) where.set(h.name, k)
  }
  if (heads.length) {
    // Pass 2: the slices again, straight into their study's bundle.
    try {
      for (const e of openEntries(input.bytes, plan.take, new Set(heads.map((h) => h.name)))) {
        const b = built.get(where.get(e.name)!)!
        if (!b.writer) { b.single = e.data; continue }
        if (b.tooBig) continue
        const h = b.heads[b.rank.get(e.name)!]
        if (!b.writer.add(`${String(b.rank.get(e.name)! + 1).padStart(4, '0')}-${h.base.replace(/[^\w.-]/g, '_')}`, e.data, h.squeeze)) b.tooBig = true
      }
    } catch (e) {
      if (!(e instanceof ZipMismatch)) throw e
      await auditRejected(tx, input, 'zip_bomb')
      return { documents, skipped, expandedZip: true, rejected: { status: 422, code: 'zip_bomb', message: e.message } }
    }
  }
  for (const b of built.values()) {
    const hs = b.heads
    const modalities = [...new Set(hs.flatMap((h) => (h.meta.modality ? [h.meta.modality] : [])))]
    const label = studyLabel(modalities)
    if (!b.writer) { if (b.single) await one({ fileName: hs[0].base, bytes: b.single }, hs[0].name); continue }
    if (b.tooBig) { skipped.push({ name: `${label} study`, reason: `the ${label} study is larger than the ${Math.round(MAX_STUDY_BUNDLE_BYTES / 1048576)} MB kept for one study` }); continue }
    const imaging = { ...hs[0].meta, modalityLabel: label, studyLabel: label, modalities, instances: hs.length, frames: hs.length }
    await one({ fileName: `${label} (${hs.length} images)`, bytes: b.writer.finish(), bundle: { imaging }, maxBytes: MAX_STUDY_BUNDLE_BYTES }, `${label} study`)
  }
  for (const e of inBacklogOrder(others, (x) => x.base)) await one({ fileName: e.base, bytes: e.data }, e.name) // FR-ONB-01: processed in this order
  if (!documents.length && skipped.length) {
    await auditRejected(tx, input, 'zip_nothing_accepted')
    return { documents, skipped, expandedZip: true, rejected: { status: 422, code: 'zip_nothing_accepted', message: `Nothing in the ZIP could be accepted: ${[...new Set(skipped.map((s) => s.reason))].join('; ')}` } }
  }
  return { documents, skipped, expandedZip: true }
}
