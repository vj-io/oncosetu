// Withdraw a request (staff or that patient/caregiver). The letter stays in the history.
import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { withdrawRequest } from '@/server/requests/requests'

export const POST = route({ auth: 'any' }, async (ctx) => withdrawRequest(ctx, patientIdParam(ctx)))
