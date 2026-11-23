import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { patientPhoneSchema, setPatientPhone } from '@/server/registration/patient-admin'

export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'], body: patientPhoneSchema }, (ctx) => setPatientPhone(ctx, patientIdParam(ctx)))
