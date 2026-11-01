import { z } from 'zod'
import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { setPrimaryContact } from '@/server/registration/patient-admin'

export const POST = route({
  auth: 'staff', roles: ['desk', 'records', 'clinician'], body: z.object({ primaryContact: z.enum(['patient', 'caregiver']) }),
}, (ctx) => setPrimaryContact(ctx, patientIdParam(ctx)))
