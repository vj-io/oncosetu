import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { patientNameSchema, setPatientName } from '@/server/registration/patient-admin'

export const POST = route({ auth: 'staff', roles: ['clinician'], body: patientNameSchema }, (ctx) => setPatientName(ctx, patientIdParam(ctx)))
