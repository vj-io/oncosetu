import { z } from 'zod'
import { withOrg } from '@/db'
import { writeAudit } from '@/server/audit'
import { phoneHmac } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { phoneLogins, verifyOtp } from '@/server/otp'
import { createSession } from '@/server/session'

export const POST = route({
  auth: 'public',
  body: z.object({ phone: z.string().max(32), code: z.string().max(12) }),
}, async ({ body, requestId }) => {
  const invalid = new HttpError(401, 'invalid_code', 'Invalid or expired code')
  const h = phoneHmac(body.phone)
  if (!h) throw invalid
  const ok = await verifyOtp(h, body.code.trim())
  const logins = await phoneLogins(h)
  const m = logins[0] // ponytail: a phone linked to several patients opens the first; add a chooser when that occurs
  if (!m) throw invalid
  const actor = { orgId: m.orgId, actorId: m.caregiverId ?? m.patientId, actorRole: m.caregiverId ? 'caregiver' : 'patient', requestId }
  if (!ok) {
    await withOrg(m.orgId, (tx) => writeAudit(tx, { ...actor, action: 'auth.otp_failed', targetType: 'patient', targetId: m.patientId }))
    throw invalid
  }
  const { sessionId } = m.caregiverId
    ? await createSession({ kind: 'caregiver', patientId: m.patientId, caregiverId: m.caregiverId, orgId: m.orgId })
    : await createSession({ kind: 'patient', patientId: m.patientId, orgId: m.orgId })
  await withOrg(m.orgId, (tx) => writeAudit(tx, { ...actor, action: 'auth.patient_login', targetType: 'session', targetId: sessionId }))
  return { ok: true, kind: m.caregiverId ? 'caregiver' : 'patient' }
})
