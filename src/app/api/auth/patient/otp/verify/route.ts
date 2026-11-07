import { z } from 'zod'
import { withOrg } from '@/db'
import { writeAudit } from '@/server/audit'
import { phoneHmac } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { isDemo } from '@/server/demo'
import { phoneLogins, verifyOtp } from '@/server/otp'
import { createSession } from '@/server/session'

export const POST = route({
  auth: 'public',
  // station: signing in on the shared desk-station tablet (FR-VOX-02), which gets a short session
  body: z.object({ phone: z.string().max(32), code: z.string().max(12), station: z.boolean().optional() }),
}, async ({ body, requestId }) => {
  const invalid = new HttpError(401, 'invalid_code', 'Invalid or expired code')
  const h = phoneHmac(body.phone)
  if (!h) throw invalid
  const code = body.code.trim()
  // In demo mode the code may come from the demo-code button (its own purpose); a normal code is tried first and nothing else changes.
  const ok = (await verifyOtp(h, code)) || (isDemo() && (await verifyOtp(h, code, 'demo_login')))
  const logins = await phoneLogins(h)
  const m = logins[0] // ponytail: a phone linked to several patients opens the first; add a chooser when that occurs
  if (!m) throw invalid
  const actor = { orgId: m.orgId, actorId: m.caregiverId ?? m.patientId, actorRole: m.caregiverId ? 'caregiver' : 'patient', requestId }
  if (!ok) {
    await withOrg(m.orgId, (tx) => writeAudit(tx, { ...actor, action: 'auth.otp_failed', targetType: 'patient', targetId: m.patientId }))
    throw invalid
  }
  const { sessionId } = m.caregiverId
    ? await createSession({ kind: 'caregiver', patientId: m.patientId, caregiverId: m.caregiverId, orgId: m.orgId, station: body.station })
    : await createSession({ kind: 'patient', patientId: m.patientId, orgId: m.orgId, station: body.station })
  await withOrg(m.orgId, (tx) => writeAudit(tx, { ...actor, action: 'auth.patient_login', targetType: 'session', targetId: sessionId, ...(body.station ? { details: { station: true } } : {}) }))
  return { ok: true, kind: m.caregiverId ? 'caregiver' : 'patient' }
})
