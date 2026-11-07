// One entry point for every upload (portal, desk, chunked): a plain file goes straight to intake; a ZIP is opened safely,
// DICOM instances are grouped into studies (one document per study), every other entry is its own document, and whatever
// cannot be accepted is listed with a plain reason instead of failing the whole upload.
import type { Tx } from '@/db'
import { MAX_ZIP_BYTES } from '@/core/limits'
import { HttpError } from '@/server/http'
import { ingestDocument, type IngestInput, type IngestResult } from './ingest'
import { sniffFile } from './filetypes'
import { bundleInstances } from './study'
import { groupDicom, planZip, type Skipped } from './zip'

export type UploadResult = { documents: IngestResult[]; skipped: Skipped[]; expandedZip: boolean }

export async function ingestUpload(tx: Tx, input: IngestInput): Promise<UploadResult> {
  const sn = sniffFile(input.bytes, input.fileName)
  if (sn?.kind !== 'zip') return { documents: [await ingestDocument(tx, input)], skipped: [], expandedZip: false }

  const plan = planZip(input.bytes)
  if (!plan.ok) throw new HttpError(plan.code === 'zip_too_large' ? 413 : 422, plan.code, plan.message)
  const skipped = [...plan.skipped]
  const documents: IngestResult[] = []
  const { studies, others } = groupDicom(plan.entries)
  const one = async (over: Partial<IngestInput>, label: string) => {
    try { documents.push(await ingestDocument(tx, { ...input, clientFileId: null, ...over })) } catch (e) {
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
  for (const e of others) await one({ fileName: e.base, bytes: e.data }, e.name)
  if (!documents.length && skipped.length) throw new HttpError(422, 'zip_nothing_accepted', `Nothing in the ZIP could be accepted: ${[...new Set(skipped.map((s) => s.reason))].join('; ')}`)
  return { documents, skipped, expandedZip: true }
}
