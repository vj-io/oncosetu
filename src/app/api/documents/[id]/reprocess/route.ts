import { route } from '@/server/http'
import { loadDocument, reprocessDocument } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

export const POST = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) =>
  reprocessDocument(ctx, await loadDocument(ctx, patientIdParam(ctx))))
