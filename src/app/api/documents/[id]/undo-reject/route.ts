import { route } from '@/server/http'
import { loadDocument, undoRejectSchema, undoRejection } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

/** REC-01: bring a rejected ("not this patient") file back to the held group. Records and clinician staff only; audited. */
export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body: undoRejectSchema }, async (ctx) =>
  undoRejection(ctx, await loadDocument(ctx, patientIdParam(ctx)), ctx.body))
