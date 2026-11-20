// A viewable picture of a DICOM file (or of one slice of a study), drawn on the server. It is a picture only: nothing is
// read from it, no findings. Same access rule as the file route; audited; never cached.
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { documentFiles, patients } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { readFile } from '@/server/files'
import { loadDocument, patientMayOpen } from '@/server/pipeline/actions'
import { renderDicomFrame } from '@/server/pipeline/dicom'
import { bundleSliceAt, STUDY_BUNDLE_MIME } from '@/server/pipeline/study'
import { studyParts } from '@/server/pipeline/study-parts'
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
  const fileOf = async (docId: string) => {
    const [f] = await ctx.db.select({ id: documentFiles.id }).from(documentFiles).where(and(eq(documentFiles.documentId, docId), eq(documentFiles.kind, 'original'))).limit(1)
    return f ? readFile(ctx.db, f.id) : null
  }
  let preview
  if (d.mime === STUDY_BUNDLE_MIME) {
    // A study that came in several uploads is stepped through as one series; the first part to arrive stands for it.
    const parts = await studyParts(ctx.db, d)
    const merged = parts.length > 1 && parts[0].id === d.id
    const list = merged ? parts : [{ id: d.id, instances: 0 }]
    let want = ctx.query.frame ?? -1
    if (want < 0) want = Math.floor((merged ? parts.reduce((n, p) => n + p.instances, 0) : (Number((d.flags as { imaging?: { instances?: number } })?.imaging?.instances) || 1)) / 2)
    let data: Uint8Array | null = null
    for (let k = 0; k < list.length; k++) {
      const file = await fileOf(list[k].id)
      if (!file) { if (k === 0) throw new HttpError(404, 'not_found', 'Not found'); continue }
      const slice = bundleSliceAt(file.bytes, want)
      const count = slice.count
      if (!merged || want < count || k === list.length - 1) { data = slice.data; break }
      want -= count
    }
    preview = data ? await renderDicomFrame(data, 0) : { ok: false as const, reason: 'no_pixels' as const, note: 'No pictures in this study' }
  } else {
    const file = await fileOf(d.id)
    if (!file) throw new HttpError(404, 'not_found', 'Not found')
    preview = await renderDicomFrame(file.bytes, ctx.query.frame)
  }
  await ctx.audit('document.view', 'document', d.id, { kind: 'preview', frame: ctx.query.frame ?? -1 })
  if (!preview.ok) return new Response(JSON.stringify({ error: { code: 'no_preview', message: preview.note } }), { status: 422, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  return new Response(new Uint8Array(preview.png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'", 'cross-origin-resource-policy': 'same-origin' } })
})
