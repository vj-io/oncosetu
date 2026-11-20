// "Open" on Today's encounters (decision 19). The desk may reopen a record only when the patient was verified today;
// the check itself is assertPatientAccess (server side). This route records every reopen, allowed or refused.
import { redirect } from 'next/navigation'
import { withOrg } from '@/db'
import { writeAudit } from '@/server/audit'
import { HttpError } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import { requireStaff } from '@/server/session'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireStaff(['desk', 'records', 'clinician'])
  const { id } = await params
  if (!UUID.test(id)) redirect('/desk')
  if (s.role !== 'desk') redirect(`/patients/${id}/overview`)
  const allowed = await withOrg(s.orgId, async (tx) => {
    let ok = true
    let reason = ''
    try {
      await assertPatientAccess({ db: tx, session: s }, id)
    } catch (e) {
      if (!(e instanceof HttpError)) throw e
      ok = false
      reason = e.code
    }
    await writeAudit(tx, {
      orgId: s.orgId, actorId: s.staffId, actorRole: s.role, targetType: 'patient', targetId: id,
      action: ok ? 'access.desk_reopen' : 'access.desk_reopen_refused', details: ok ? {} : { reason },
    })
    return ok
  })
  // A refusal lands on the patient page, which explains it and sends the desk to the lookup.
  redirect(allowed ? `/patients/${id}/overview` : `/desk?patient=${id}`)
}
