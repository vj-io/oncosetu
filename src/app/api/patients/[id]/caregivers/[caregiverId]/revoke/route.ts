import { HttpError, route } from '@/server/http'
import { revokeCaregiver } from '@/server/registration/caregivers'
import { fail, patientIdParam } from '@/server/registration/http'

// Sessions of the caregiver die at once and are refused on the next request (E-ID-09).
export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'] }, async (ctx) => {
  const r = await revokeCaregiver(ctx, patientIdParam(ctx), patientIdParam(ctx, 'caregiverId'))
  if (r === 'not_found') throw new HttpError(404, 'not_found', 'Not found')
  if (r === 'last_contact') return fail(409, 'last_contact', 'This is the only contact for the patient. Add another caregiver or change the primary contact first.')
  return { ok: true }
})
