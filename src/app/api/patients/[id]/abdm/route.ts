// The ABDM panel on the Documents tab (FR-ING-ABDM-01): requests, transfers, received bundles. Reading it also runs the
// erase-at check for this patient (PRD §10.5), so data past its artefact's erase-at is gone before anyone sees it.
import { eraseDue, staffAbdmView } from '@/server/abdm/flow'
import { route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'

export const GET = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  await eraseDue({ db: ctx.db, orgId: ctx.session.orgId, audit: ctx.audit }, patientId)
  return staffAbdmView(ctx.db, patientId)
})
