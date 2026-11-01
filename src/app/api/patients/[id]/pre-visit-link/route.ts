import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { sendPreVisitLink } from '@/server/registration/previsit'

export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'] }, (ctx) => sendPreVisitLink(ctx, patientIdParam(ctx)))
