import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { disclosureSchema, setDisclosure } from '@/server/registration/patient-admin'

// Clinician only (FR-CON-07): desk and records get 403 before the body is read. Every change is audited with a reason code.
export const POST = route({ auth: 'staff', roles: ['clinician'], body: disclosureSchema }, (ctx) => setDisclosure(ctx, patientIdParam(ctx)))
