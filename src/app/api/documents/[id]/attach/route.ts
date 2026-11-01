import { route } from '@/server/http'
import { attachSchema, decideAttachment, loadDocument } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

/** FR-ID-05: a person attaches (with a reason) or rejects a document whose identity was mismatch / insufficient. */
export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body: attachSchema }, async (ctx) =>
  decideAttachment(ctx, await loadDocument(ctx, patientIdParam(ctx)), ctx.body))
