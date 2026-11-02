import { route } from '@/server/http'
import { rotateAlias } from '@/server/inbound/staff'
import { patientIdParam } from '@/server/registration/http'

// FR-ING-04: create the patient's drop address, or replace it (the old one stops working at once).
export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'] }, (ctx) => rotateAlias(ctx, patientIdParam(ctx)))
