// J8: records/clinician staff record an erasure request on the patient's behalf (the record itself is closed by the consent withdrawal).
import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { requestErasure } from '@/server/erasure/erasure'

export const POST = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) => requestErasure(ctx, patientIdParam(ctx)))
