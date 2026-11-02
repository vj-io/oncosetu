import { route } from '@/server/http'
import { addContactEmail, addContactEmailSchema } from '@/server/inbound/staff'
import { patientIdParam } from '@/server/registration/http'

// FR-ING-04: an address checked in person with the patient or a caregiver; only these may send to the drop address.
export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'], body: addContactEmailSchema }, (ctx) => addContactEmail(ctx, patientIdParam(ctx)))
