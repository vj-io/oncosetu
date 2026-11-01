// The signed-in patient's / caregiver's own requests, tracked lazily on read (neutral labels unless cleared).
import { route } from '@/server/http'
import { listRequests } from '@/server/requests/requests'

export const GET = route({ auth: 'patient' }, async (ctx) =>
  ({ requests: await listRequests(ctx.db, ctx.session.orgId, ctx.session.patientId, 'patient') }))
