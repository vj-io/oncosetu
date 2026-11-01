import { route } from '@/server/http'
import { patientIdParam } from '@/server/registration/http'
import { breakGlassSchema, grantBreakGlass } from '@/server/registration/patient-admin'

// 4-hour access outside consent (FR-ID-10, V06-E2E-01). Reason required; the patient or primary contact is told.
export const POST = route({ auth: 'staff', roles: ['clinician', 'org_admin'], body: breakGlassSchema }, (ctx) => grantBreakGlass(ctx, patientIdParam(ctx)))
