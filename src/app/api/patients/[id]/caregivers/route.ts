import { route } from '@/server/http'
import { addCaregiver, addCaregiverSchema } from '@/server/registration/caregivers'
import { patientIdParam } from '@/server/registration/http'

export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'], body: addCaregiverSchema }, (ctx) => addCaregiver(ctx, patientIdParam(ctx)))
