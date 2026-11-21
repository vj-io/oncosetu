// A staff member who has forgotten their password sets a new one from the sign-in page. The deployment sends no e-mail or
// SMS, so the proof is the code from the authenticator app they enrolled (src/server/admin/staff.ts): something they have,
// used once (ASVS 2.8.4), as at sign-in. Because the code alone replaces the password, guessing is held tighter than at
// sign-in: wrong codes count toward the same lock (5 → 15 minutes), and after DAILY_CODE_FAILURES wrong codes in a day the
// reset stays closed for that account until the administrator helps. Accounts with a shared or no authenticator (demo,
// E2E) cannot use it. Every refusal looks the same, so the page does not reveal which e-mails exist. On success every
// sign-in of the account ends; the change and each refusal are written to the audit trail.
import { and, count, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { db, withOrg } from '@/db'
import { auditLog, sessions, staff } from '@/db/schema'
import { type AuditDetails, writeAudit } from './audit'
import { decryptField, hashPassword } from './crypto'
import { HttpError } from './http'
import { countWrongGuess, MAX_FAILURES, MIN_PASSWORD } from './own-password'
import { demoTotpSecret, totpStep } from './totp'

export const DAILY_CODE_FAILURES = 10

export async function resetForgottenPassword(input: { email: string; totp: string; next: string }, requestId: string): Promise<{ ended: number }> {
  if (input.next.length < MIN_PASSWORD) throw new HttpError(400, 'weak_password', `The new password needs at least ${MIN_PASSWORD} characters`)
  const generic = new HttpError(401, 'invalid_credentials', 'Email or code is incorrect')
  const [s] = await db.select().from(staff).where(eq(staff.email, input.email.trim().toLowerCase()))
  if (!s) throw generic
  const audit = (action: string, details: AuditDetails) => withOrg(s.orgId, (tx) => writeAudit(tx, {
    orgId: s.orgId, actorId: s.id, actorRole: s.role, action, targetType: 'staff', targetId: s.id, requestId, details,
  }))
  const secret = s.totpSecretEnc && s.totpEnabled ? decryptField(s.totpSecretEnc) : null
  const refusal = !s.active ? 'inactive'
    : s.isDemo || !secret || secret === demoTotpSecret(s.email) ? 'no_authenticator'
    : s.lockedUntil && s.lockedUntil > new Date() ? 'locked'
    : (await codeFailuresToday(s.orgId, s.id)) >= DAILY_CODE_FAILURES ? 'daily_limit'
    : null
  if (refusal || !secret) {
    await audit('auth.password_reset_failed', { reason: refusal ?? 'no_authenticator' })
    throw generic
  }
  const step = totpStep(secret, input.totp.trim())
  const claimed = step !== null && (await db.update(staff).set({ totpLastStep: step })
    .where(and(eq(staff.id, s.id), or(isNull(staff.totpLastStep), lt(staff.totpLastStep, step)))).returning({ id: staff.id })).length > 0
  if (!claimed) {
    const failed = await countWrongGuess(db, s.id)
    await audit('auth.password_reset_failed', { reason: 'code', locked: failed >= MAX_FAILURES })
    throw generic
  }
  await db.update(staff).set({ passwordHash: await hashPassword(input.next), failedLogins: 0, lockedUntil: null }).where(eq(staff.id, s.id))
  const ended = (await db.update(sessions).set({ revokedAt: new Date() })
    .where(and(eq(sessions.staffId, s.id), isNull(sessions.revokedAt))).returning({ id: sessions.id })).length
  await audit('auth.password_reset', { ended })
  return { ended }
}

/** Wrong codes sent to the reset in the last 24 hours (refusals for other reasons do not count). */
async function codeFailuresToday(orgId: string, staffId: string): Promise<number> {
  return withOrg(orgId, async (tx) => (await tx.select({ n: count() }).from(auditLog).where(and(
    eq(auditLog.orgId, orgId), eq(auditLog.targetType, 'staff'), eq(auditLog.targetId, staffId),
    eq(auditLog.action, 'auth.password_reset_failed'), sql`${auditLog.details}->>'reason' = 'code'`, gt(auditLog.at, sql`now() - interval '1 day'`),
  )))[0].n)
}
