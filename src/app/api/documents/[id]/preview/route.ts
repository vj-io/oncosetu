// A viewable picture of a DICOM file (or of one slice of a study), drawn on the server. It is a picture only: nothing is
// read from it, no findings. Same access rule as the file route; audited; never cached.
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { documentFiles, patients } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { readFile } from '@/server/files'
import { loadDocument, patientMayOpen } from '@/server/pipeline/actions'
import { renderDicomFrame, type Preview } from '@/server/pipeline/dicom'
import { bundleSliceAt, STUDY_BUNDLE_MIME } from '@/server/pipeline/study'
import { previewTarget, studyParts } from '@/server/pipeline/study-parts'
import { patientIdParam } from '@/server/registration/http'

const q = z.object({ frame: z.coerce.number().int().min(0).max(100000).optional() })
export const GET = route({ auth: 'any', query: q }, async (ctx) => {
  if (ctx.session.kind === 'staff' && !['records', 'clinician'].includes(ctx.session.role)) throw new HttpError(403, 'forbidden', 'Not allowed')
  const d = await loadDocument(ctx, patientIdParam(ctx))
  if (ctx.session.kind !== 'staff') {
    const [p] = await ctx.db.select({ disclosure: patients.disclosureStatus }).from(patients).where(eq(patients.id, d.patientId))
    if (!patientMayOpen(d, p?.disclosure ?? 'unknown')) throw new HttpError(404, 'not_found', 'Not found')
  }
  if (d.status === 'quarantined') throw new HttpError(403, 'quarantined', 'This file is quarantined and cannot be opened')
  if (d.mime !== 'application/dicom' && d.mime !== STUDY_BUNDLE_MIME) throw new HttpError(404, 'not_found', 'Not found')
  // One picture of one stored file: a single DICOM (frame `index`), or slice `index` of a study bundle. Never throws for a bad file.
  const pictureOf = async (docId: string, mime: string, index?: number): Promise<Preview> => {
    const [f] = await ctx.db.select({ id: documentFiles.id }).from(documentFiles).where(and(eq(documentFiles.documentId, docId), eq(documentFiles.kind, 'original'))).limit(1)
    const file = f && (await readFile(ctx.db, f.id))
    if (!file) throw new HttpError(404, 'not_found', 'Not found')
    if (mime !== STUDY_BUNDLE_MIME) return renderDicomFrame(file.bytes, index)
    let slice: Uint8Array | null = null
    try { slice = bundleSliceAt(file.bytes, index).data } catch { /* a damaged bundle: no picture, the file stays stored */ }
    return slice ? renderDicomFrame(slice, 0) : { ok: false, reason: 'no_pixels', note: 'Preview not available — file stored' }
  }
  // A study that came in several uploads is stepped through as one series; the part that arrived first stands for it.
  const at = previewTarget(d, await studyParts(ctx.db, d), ctx.query.frame)
  const preview = await pictureOf(at.id, at.mime, at.index)
  await ctx.audit('document.view', 'document', d.id, { kind: 'preview', frame: ctx.query.frame ?? -1, ...(at.id !== d.id ? { part: at.id } : {}) })
  if (!preview.ok) return new Response(JSON.stringify({ error: { code: 'no_preview', message: preview.note } }), { status: 422, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  return new Response(new Uint8Array(preview.png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'", 'cross-origin-resource-policy': 'same-origin' } })
})
