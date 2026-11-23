// Patient / caregiver sign-in with the mobile number on file and the password they chose (src/server/portal/password.ts).
import { z } from 'zod'
import { withOrg } from '@/db'
import { writeAudit } from '@/server/audit'
import { HttpError, route } from '@/server/http'
import { checkPassword } from '@/server/portal/password'
import { createSession } from '@/server/session'

export const POST = route({
  auth: 'public',
  body: z.object({ phone: z.string().max(32), password: z.string().max(200), station: z.boolean().optional() }),
}, async ({ body, requestId }) => {
  const r = await checkPassword(body.phone, body.password, requestId)
  if (!r.ok) {
    if (r.locked) throw new HttpError(429, 'locked', 'Too many wrong passwords. Wait 15 minutes, or ask the front desk for a sign-in code.')
    throw new HttpError(401, 'invalid_login', 'Mobile number or password is not right')
  }
  const m = r.login
  const { sessionId } = m.caregiverId
    ? await createSession({ kind: 'caregiver', patientId: m.patientId, caregiverId: m.caregiverId, orgId: m.orgId, station: body.station })
    : await createSession({ kind: 'patient', patientId: m.patientId, orgId: m.orgId, station: body.station })
  await withOrg(m.orgId, (tx) => writeAudit(tx, {
    orgId: m.orgId, actorId: m.caregiverId ?? m.patientId, actorRole: m.caregiverId ? 'caregiver' : 'patient', requestId,
    action: 'auth.patient_login', targetType: 'session', targetId: sessionId, details: { method: 'password', ...(body.station ? { station: true } : {}) },
  }))
  return { ok: true, kind: m.caregiverId ? 'caregiver' : 'patient' }
})
