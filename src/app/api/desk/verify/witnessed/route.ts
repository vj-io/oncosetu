import { z } from 'zod'
import { route } from '@/server/http'
import { deskVerifyWitnessed } from '@/server/registration/desk'

export const POST = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'], body: z.object({ patientId: z.uuid(), attest: z.literal(true) }),
}, (ctx) => deskVerifyWitnessed(ctx))
