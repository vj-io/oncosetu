import { route } from '@/server/http'
import { revokeContactEmail } from '@/server/inbound/staff'
import { patientIdParam } from '@/server/registration/http'

export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'] }, (ctx) =>
  revokeContactEmail(ctx, patientIdParam(ctx), patientIdParam(ctx, 'contactId')))
