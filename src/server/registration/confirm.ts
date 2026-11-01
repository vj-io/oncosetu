// OTP and witnessed confirmation for registration, desk verification, caregivers and consent changes.
// OTP codes reuse src/server/otp.ts: 6 digits, 5 min, 5 failed attempts lock the phone for 15 minutes.
import { and, desc, eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { db } from '@/db'
import { otpChallenges } from '@/db/schema'
import { authCopy } from '@/i18n/auth'
import { phoneHmac } from '../crypto'
import { startOtp, verifyOtp } from '../otp'
import { sendMessage } from '../outbox'
import type { ContactTarget } from './contact'
import { fail } from './http'
import type { Confirm } from './schemas'

export type OtpCheck = 'ok' | 'invalid' | 'locked' | 'no_phone'

async function lockedUntil(h: string, purpose: string): Promise<Date | null> {
  const [c] = await db.select({ l: otpChallenges.lockedUntil }).from(otpChallenges)
    .where(and(eq(otpChallenges.phoneHmac, h), eq(otpChallenges.purpose, purpose))).orderBy(desc(otpChallenges.createdAt)).limit(1)
  return c?.l && c.l > new Date() ? c.l : null
}

/** Sends a code to `target` as a simulated SMS (neutral "Setu Records" wording). */
export async function sendOtpTo(tx: Tx, p: { orgId: string; patientId: string | null; target: ContactTarget | null; purpose: string; templateKey: string }): Promise<'sent' | 'locked' | 'no_phone'> {
  const h = p.target ? phoneHmac(p.target.phone) : null
  if (!p.target || !h) return 'no_phone'
  const issued = await startOtp(h, p.purpose)
  if (!issued) return 'locked'
  await sendMessage(tx, {
    orgId: p.orgId, patientId: p.patientId, toPhone: p.target.phone, channel: 'sms', templateKey: p.templateKey,
    body: authCopy.otpSms[p.target.lang](issued.code), lang: p.target.lang,
  })
  return 'sent'
}

export async function checkOtp(target: ContactTarget | null, purpose: string, code: string): Promise<OtpCheck> {
  const h = target ? phoneHmac(target.phone) : null
  if (!h) return 'no_phone'
  if (await verifyOtp(h, code.trim(), purpose)) return 'ok'
  return (await lockedUntil(h, purpose)) ? 'locked' : 'invalid'
}

const OTP_ERRORS = {
  invalid: [401, 'invalid_code', 'That code is not valid or has expired.'],
  locked: [429, 'locked', 'Too many wrong codes. This phone is locked for 15 minutes.'],
  no_phone: [409, 'no_phone', 'There is no phone number to send a code to. Use in-person witnessed confirmation.'],
} as const

/** Error response for a failed check, or null when it passed. Returned (not thrown) so audit rows still commit. */
export const otpFailure = (r: OtpCheck) => {
  if (r === 'ok') return null
  const [status, code, message] = OTP_ERRORS[r]
  return fail(status, code, message)
}

/** Confirms a sensitive action: a code from `target`'s phone, or an in-person witnessed attestation. */
export async function confirmAction(target: ContactTarget | null, purpose: string, c: Confirm): Promise<{ ok: true; method: 'otp' | 'witnessed' } | { ok: false; response: Response }> {
  if (c.method === 'witnessed') return { ok: true, method: 'witnessed' }
  const r = await checkOtp(target, purpose, c.code)
  return r === 'ok' ? { ok: true, method: 'otp' } : { ok: false, response: otpFailure(r)! }
}

export const confirmPurpose = (patientId: string) => `confirm:${patientId}`
export const deskPurpose = (patientId: string) => `desk:${patientId}`
export const CONSENT_PURPOSE = 'consent'
