import { route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { patientIdParam } from '@/server/registration/http'
import { finishUpload } from '@/server/uploads/finish'

/** Staff: all chunks are in. Joins them, checks size and checksum, runs intake (a ZIP is opened safely). */
export const POST = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'] }, async (ctx) => {
  const patientId = patientIdParam(ctx)
  await assertPatientAccess(ctx, patientId)
  return finishUpload({ db: ctx.db, orgId: ctx.session.orgId, patientId, uploader: { kind: 'staff', id: ctx.session.staffId }, sessionId: patientIdParam(ctx, 'sid'), audit: ctx.audit })
})
