import { z } from 'zod'
import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { transferControl } from '@/server/registration/patient-admin'
import { confirmSchema } from '@/server/registration/schemas'

// E-ID-10: a minor who has turned 18 takes control; guardian access ends.
export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'], body: z.object({ confirm: confirmSchema }) }, (ctx) => transferControl(ctx, patientIdParam(ctx)))
