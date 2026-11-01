import { z } from 'zod'
import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { setDeceased } from '@/server/registration/patient-admin'

// E-ID-11: staff record the status; patient-facing access closes on the next request.
export const POST = route({ auth: 'staff', roles: ['records', 'clinician'], body: z.object({ deceased: z.boolean() }) }, (ctx) => setDeceased(ctx, patientIdParam(ctx)))
