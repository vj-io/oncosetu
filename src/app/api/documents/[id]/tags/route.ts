import { route } from '@/server/http'
import { loadDocument, tagDocument, tagsSchema } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

/** FR-DOC-07 / FR-EXT-07: staff tag the document type, date and institution (the only option for handwritten pages). */
export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body: tagsSchema }, async (ctx) =>
  tagDocument(ctx, await loadDocument(ctx, patientIdParam(ctx)), ctx.body))
