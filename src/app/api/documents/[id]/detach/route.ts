import { route } from '@/server/http'
import { detachDocument, detachSchema, loadDocument } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

/** FR-ID-06: detach a wrongly attached document; its events are withdrawn and sealed snapshots get an erratum. */
export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body: detachSchema }, async (ctx) =>
  detachDocument(ctx, await loadDocument(ctx, patientIdParam(ctx)), ctx.body))
