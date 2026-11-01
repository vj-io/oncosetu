// Guard for the workspace tab pages. The workspace layout renders the denial UI; the page itself must also refuse
// to read anything (layouts and pages render independently), then returns null.
import type { Tx } from '@/db'
import { withOrg } from '@/db'
import { HttpError } from '../http'
import { assertPatientAccess } from '../patients'
import { requireStaff, type StaffSession } from '../session'

export async function withPatientAccess<T>(patientId: string, fn: (tx: Tx, session: StaffSession) => Promise<T>): Promise<T | null> {
  const session = await requireStaff()
  return withOrg(session.orgId, async (tx) => {
    try {
      await assertPatientAccess({ db: tx, session }, patientId)
    } catch (e) {
      if (e instanceof HttpError && (e.status === 403 || e.status === 404)) return null
      throw e
    }
    return fn(tx, session)
  })
}
