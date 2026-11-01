import { route } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { listSnapshots } from '@/server/ledger/record'
import { idParam } from '@/server/ledger/verify'

export const GET = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) => {
  const patientId = idParam(ctx)
  await assertPatientAccess(ctx, patientId)
  return { snapshots: await listSnapshots(ctx.db, patientId) }
})
