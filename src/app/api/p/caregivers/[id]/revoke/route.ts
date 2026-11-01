// Patient removes a caregiver's access (FR-CON-02). A caregiver cannot change this list ('caregiver.manage').
import { HttpError, route } from '@/server/http'
import { revokeCaregiver } from '@/server/portal/consent'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = route({ auth: 'patient' }, async ({ session, db, params, audit }) => {
  if (session.kind !== 'patient') throw new HttpError(403, 'forbidden', 'Not allowed')
  const id = String(params.id)
  if (!UUID.test(id) || !(await revokeCaregiver(db, session.orgId, session.patientId, id))) throw new HttpError(404, 'not_found', 'Not found')
  await audit('caregiver.revoke', 'caregiver', id)
  return { ok: true }
})
