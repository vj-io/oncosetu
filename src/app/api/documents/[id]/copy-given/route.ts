// Records or clinician staff record that the patient's requested copy was given (copies.ts).
import { route } from '@/server/http'
import { giveCopy } from '@/server/portal/copies'
import { loadDocument } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

export const POST = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) => {
  const d = await loadDocument(ctx, patientIdParam(ctx))
  return giveCopy(ctx, d.id)
})
