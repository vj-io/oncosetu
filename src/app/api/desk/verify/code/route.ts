import { z } from 'zod'
import { route } from '@/server/http'
import { deskVerifyCode } from '@/server/registration/desk'

export const POST = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'], body: z.object({ patientId: z.uuid(), code: z.string().trim().min(4).max(12) }),
}, (ctx) => deskVerifyCode(ctx))
