import { withOrg } from '@/db'
import { writeAudit } from '@/server/audit'
import { route } from '@/server/http'
import { destroySession, getSession, sessionRole } from '@/server/session'

export const POST = route({ auth: 'public' }, async ({ requestId }) => {
  const s = await getSession()
  await destroySession()
  if (s) {
    await withOrg(s.orgId, (tx) => writeAudit(tx, {
      orgId: s.orgId, actorId: s.kind === 'staff' ? s.staffId : (s.caregiverId ?? s.patientId), actorRole: sessionRole(s),
      action: 'auth.logout', targetType: 'session', targetId: s.sessionId, requestId,
    }))
  }
  return { ok: true }
})
