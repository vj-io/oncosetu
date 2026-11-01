// J8: the patient or caregiver asks for their records to be erased after withdrawing consent. Queued per retention policy.
import { route } from '@/server/http'
import { requestErasure } from '@/server/erasure/erasure'

export const POST = route({ auth: 'patient' }, async (ctx) => requestErasure(ctx, ctx.session.patientId))
