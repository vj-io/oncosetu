// DEMO_MODE only. Issues a short-lived sign-in code for a seeded demo phone and puts it in the simulated SMS outbox (the demo
// phone). The person still enters the code and presses Sign in. Refused (404) when demo mode is off, 403 for any other phone.
import { z } from 'zod'
import { withOrg } from '@/db'
import { authCopy } from '@/i18n/auth'
import { writeAudit } from '@/server/audit'
import { phoneHmac } from '@/server/crypto'
import { decideDemoCode } from '@/server/demo-login'
import { HttpError, route } from '@/server/http'
import { phoneLogins, startDemoOtp } from '@/server/otp'
import { sendMessage } from '@/server/outbox'

export const POST = route({ auth: 'public', body: z.object({ phone: z.string().max(32) }) }, async ({ body, requestId, req }) => {
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim()
  const d = decideDemoCode({ phone: body.phone, ip })
  if (!d.ok) throw new HttpError(d.status, d.code, d.code === 'rate_limited' ? 'Too many demo sign-ins from this network. Try again in a few minutes.' : 'Not found')
  const h = phoneHmac(body.phone)!
  const m = (await phoneLogins(h))[0]
  if (!m) throw new HttpError(404, 'not_found', 'Not found') // demo data not seeded
  const { code } = await startDemoOtp(h)
  await withOrg(m.orgId, async (tx) => {
    await sendMessage(tx, { orgId: m.orgId, patientId: m.patientId, toPhone: body.phone, channel: 'sms', templateKey: 'auth.otp', body: authCopy.otpSms[m.preferredLanguage](code), lang: m.preferredLanguage })
    await writeAudit(tx, { orgId: m.orgId, actorId: m.caregiverId ?? m.patientId, actorRole: m.caregiverId ? 'caregiver' : 'patient', action: 'auth.demo_signin', targetType: 'patient', targetId: m.patientId, requestId })
  })
  return { ok: true }
})
