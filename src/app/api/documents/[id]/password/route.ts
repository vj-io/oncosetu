import { route } from '@/server/http'
import { loadDocument, passwordSchema, submitPassword } from '@/server/pipeline/actions'
import { patientIdParam } from '@/server/registration/http'

/** FR-ING-07: retry a password-protected PDF with a password that is used once and never stored. */
export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'], body: passwordSchema }, async (ctx) =>
  submitPassword(ctx, await loadDocument(ctx, patientIdParam(ctx)), ctx.body))
