import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { issueSigninCode } from '@/server/registration/signin-code'

export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'] }, (ctx) => issueSigninCode(ctx, patientIdParam(ctx)))
