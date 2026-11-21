import { z } from 'zod'
import { withOrg } from '@/db'
import { authCopy } from '@/i18n/auth'
import { writeAudit } from '@/server/audit'
import { phoneHmac } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { phoneLogins, startOtp } from '@/server/otp'
import { sendMessage } from '@/server/outbox'
import { smsAvailable } from '@/server/sms/provider'

// Always 200 {ok:true}: the response never reveals whether a phone is known (anti-enumeration).
export const POST = route({ auth: 'public', body: z.object({ phone: z.string().max(32) }) }, async ({ body, requestId }) => {
  // no text messages at this clinic: say so to everyone alike (reveals nothing about the phone)
  if (!smsAvailable()) throw new HttpError(503, 'sms_unavailable', 'Sign-in by phone is not available at this clinic yet. Please ask at the front desk.')
  const h = phoneHmac(body.phone)
  const logins = h ? await phoneLogins(h) : []
  if (!h || !logins.length) return { ok: true }
  const issued = await startOtp(h)
  const m = logins[0]
  if (!issued) { // locked or over the send limit: same reply as always (no enumeration), but the event is recorded
    await withOrg(m.orgId, (tx) => writeAudit(tx, { orgId: m.orgId, actorId: m.caregiverId ?? m.patientId, actorRole: m.caregiverId ? 'caregiver' : 'patient', action: 'auth.otp_limited', targetType: 'patient', targetId: m.patientId, requestId, details: { outcome: 'locked' } }))
    return { ok: true }
  }
  await withOrg(m.orgId, async (tx) => {
    await sendMessage(tx, {
      orgId: m.orgId, patientId: m.patientId, toPhone: body.phone, channel: 'sms', templateKey: 'auth.otp',
      body: authCopy.otpSms[m.preferredLanguage](issued.code), lang: m.preferredLanguage,
    })
    await writeAudit(tx, {
      orgId: m.orgId, actorId: m.caregiverId ?? m.patientId, actorRole: m.caregiverId ? 'caregiver' : 'patient',
      action: 'auth.otp_sent', targetType: 'patient', targetId: m.patientId, requestId,
    })
  })
  return { ok: true }
})
