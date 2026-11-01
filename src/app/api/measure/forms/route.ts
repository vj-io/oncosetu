import { route } from '@/server/http'
import { submitMeasurement } from '@/server/admin/measurement'
import { measureForm } from '@/server/admin/schemas'

// §16.4 60-second consultation form. By encounter id only; no patient fields exist on the form.
export const POST = route({ auth: 'staff', roles: ['clinician'], body: measureForm }, (ctx) => submitMeasurement(ctx, ctx.body))
