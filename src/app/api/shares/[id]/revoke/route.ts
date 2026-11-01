// Switch a share link off (E-PAS-03): staff with access to the patient, or that patient/caregiver. 410 from the next open.
import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { revokeShareFor } from '@/server/shares/shares'

export const POST = route({ auth: 'any', roles: ['patient', 'caregiver', 'desk', 'records', 'clinician'] }, async (ctx) =>
  revokeShareFor(ctx, patientIdParam(ctx)))
