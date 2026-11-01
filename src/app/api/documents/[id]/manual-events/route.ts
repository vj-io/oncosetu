import { route } from '@/server/http'
import { addManualEvent, loadDocument, manualEventSchema } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

/** FR-EXT-07: a staff-keyed fact, still gated: its quote must be on the page and every value inside the quote. */
export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body: manualEventSchema }, async (ctx) =>
  addManualEvent(ctx, await loadDocument(ctx, patientIdParam(ctx)), ctx.body))
