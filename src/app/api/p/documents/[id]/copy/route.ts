// The patient or caregiver asks the clinic for a copy of a paper they cannot open in the portal (copies.ts). No body.
import { route } from '@/server/http'
import { idParam } from '@/server/ledger/verify'
import { requestCopy } from '@/server/portal/copies'

export const POST = route({ auth: 'patient' }, (ctx) => requestCopy(ctx, idParam(ctx)))
