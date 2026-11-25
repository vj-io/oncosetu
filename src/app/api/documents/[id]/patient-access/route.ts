// Records or clinician staff give the patient access to read this one paper in the portal, answering their request (copies.ts).
import { route } from '@/server/http'
import { grantAccess } from '@/server/portal/copies'
import { loadDocument } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

export const POST = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) => {
  const d = await loadDocument(ctx, patientIdParam(ctx))
  return grantAccess(ctx, d.id)
})
