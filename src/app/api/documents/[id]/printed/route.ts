import { route } from '@/server/http'
import { loadDocument, markPrinted } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

export const POST = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) =>
  markPrinted(ctx, await loadDocument(ctx, patientIdParam(ctx))))
