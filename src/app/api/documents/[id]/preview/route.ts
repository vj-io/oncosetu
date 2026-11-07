// A viewable picture of a DICOM file (or of one slice of a study), drawn on the server. It is a picture only: nothing is
// read from it, no findings. Same access rule as the file route; audited; never cached.
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { documentFiles, patients } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { readFile } from '@/server/files'
import { loadDocument, patientMayOpen } from '@/server/pipeline/actions'
import { renderDicomFrame } from '@/server/pipeline/dicom'
import { orderedInstances, STUDY_BUNDLE_MIME } from '@/server/pipeline/study'
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
  const [f] = await ctx.db.select({ id: documentFiles.id }).from(documentFiles).where(and(eq(documentFiles.documentId, d.id), eq(documentFiles.kind, 'original'))).limit(1)
  const file = f && (await readFile(ctx.db, f.id))
  if (!file) throw new HttpError(404, 'not_found', 'Not found')
  let preview
  if (d.mime === STUDY_BUNDLE_MIME) {
    const slices = orderedInstances(file.bytes)
    const i = Math.min(ctx.query.frame ?? Math.floor(slices.length / 2), slices.length - 1)
    preview = slices.length ? await renderDicomFrame(slices[i], 0) : { ok: false as const, reason: 'no_pixels' as const, note: 'No pictures in this study' }
  } else preview = await renderDicomFrame(file.bytes, ctx.query.frame)
  await ctx.audit('document.view', 'document', d.id, { kind: 'preview', frame: ctx.query.frame ?? -1 })
  if (!preview.ok) return new Response(JSON.stringify({ error: { code: 'no_preview', message: preview.note } }), { status: 422, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  return new Response(new Uint8Array(preview.png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'", 'cross-origin-resource-policy': 'same-origin' } })
})
