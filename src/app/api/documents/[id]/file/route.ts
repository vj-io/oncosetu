import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { documentFiles, patients } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { readFile } from '@/server/files'
import { loadDocument, patientMayOpen } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

const q = z.object({ kind: z.enum(['original', 'page']).default('original'), page: z.coerce.number().int().min(1).default(1) })

/** Streams decrypted bytes (original or re-encoded page image). Records/clinician or the patient (see patientMayOpen); audited; never cached. */
export const GET = route({ auth: 'any', query: q }, async (ctx) => {
  if (ctx.session.kind === 'staff' && !['records', 'clinician'].includes(ctx.session.role)) throw new HttpError(403, 'forbidden', 'Not allowed')
  const d = await loadDocument(ctx, patientIdParam(ctx))
  if (ctx.session.kind !== 'staff') {
    const [p] = await ctx.db.select({ disclosure: patients.disclosureStatus }).from(patients).where(eq(patients.id, d.patientId))
    if (!patientMayOpen(d, p?.disclosure ?? 'unknown')) throw new HttpError(404, 'not_found', 'Not found')
  }
  if (d.status === 'quarantined') throw new HttpError(403, 'quarantined', 'This file is quarantined and cannot be opened')
  const kind = ctx.query.kind === 'page' ? 'page_image' : 'original'
  const where = kind === 'original'
    ? and(eq(documentFiles.documentId, d.id), eq(documentFiles.kind, 'original'))
    : and(eq(documentFiles.documentId, d.id), eq(documentFiles.kind, 'page_image'), eq(documentFiles.pageNo, ctx.query.page))
  const [f] = await ctx.db.select({ id: documentFiles.id }).from(documentFiles).where(where).limit(1)
  const file = f && (await readFile(ctx.db, f.id))
  if (!file) throw new HttpError(404, 'not_found', 'Not found')
  await ctx.audit('document.view', 'document', d.id, { kind: ctx.query.kind, page: ctx.query.page })
  const headers: Record<string, string> = {
    'content-type': file.mime, 'content-disposition': 'inline', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store',
    'content-length': String(file.bytes.length), 'cross-origin-resource-policy': 'same-origin',
  }
  // PDFs render in the browser's viewer with scripts and forms disabled; images need no exception.
  headers['content-security-policy'] = file.mime === 'application/pdf' ? 'sandbox' : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
  return new Response(new Uint8Array(file.bytes), { headers })
})
