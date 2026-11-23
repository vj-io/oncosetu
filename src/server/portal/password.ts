// Portal password (0029): a patient or caregiver signs in from home with the mobile number on file and a password they
// chose after a first sign-in with a one-time code. A forgotten password is replaced the same way: sign in with a code
// from the front desk, choose a new one. 5 wrong passwords lock that sign-in for 15 minutes (as for staff).
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { withOrg, type Tx } from '@/db'
import { caregivers, patients, sessions } from '@/db/schema'
import { writeAudit } from '../audit'
import { hashPassword, phoneHmac, verifyPassword } from '../crypto'
import { phoneLogins, type PhoneLogin } from '../otp'
import { readOrNull } from '../unreadable'

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
const MAX_FAILURES = 5

export type PasswordProblem = 'too_short' | 'too_long' | 'is_phone' | 'too_simple'

/** Pure: what is wrong with a new password, or null. Kept short on purpose: length matters most, rules annoy. */
export function passwordProblem(pw: string, phone: string | null): PasswordProblem | null {
  if (pw.length < PASSWORD_MIN) return 'too_short'
  if (pw.length > PASSWORD_MAX) return 'too_long'
  const digits = (phone ?? '').replace(/\D/g, '')
  const pwDigits = pw.replace(/\D/g, '')
  if (digits.length >= 10 && pwDigits.length >= 8 && digits.endsWith(pwDigits.slice(-10))) return 'is_phone'
  if (new Set(pw.toLowerCase()).size < 3 || /^(?:0?123456789?|password\d*|qwerty\w*|abcd\w*)$/i.test(pw)) return 'too_simple'
  return null
}

type Who = { kind: 'patient' | 'caregiver'; patientId: string; caregiverId?: string }
const table = (w: Who) => (w.kind === 'caregiver' ? caregivers : patients)
const rowId = (w: Who) => (w.kind === 'caregiver' ? w.caregiverId! : w.patientId)

/** The signed-in person's own phone (to refuse it as a password) and whether a password is set. */
export async function passwordState(tx: Tx, w: Who): Promise<{ hasPassword: boolean; phone: string | null }> {
  const t = table(w)
  const [r] = await tx.select({ hash: t.passwordHash, phoneEnc: t.phoneEnc }).from(t).where(eq(t.id, rowId(w)))
  return { hasPassword: !!r?.hash, phone: r ? readOrNull(r.phoneEnc, 'portal phone', w.patientId) : null }
}

/** Sets the password; signs out this person's other sessions (a new password is often a response to a lost phone). */
export async function setPassword(tx: Tx, w: Who & { sessionId: string }, password: string): Promise<{ first: boolean; endedSessions: number }> {
  const t = table(w)
  const [r] = await tx.select({ hash: t.passwordHash }).from(t).where(eq(t.id, rowId(w)))
  await tx.update(t).set({ passwordHash: await hashPassword(password), passwordSetAt: new Date(), passwordFailed: 0, passwordLockedUntil: null })
    .where(eq(t.id, rowId(w)))
  const mine = w.kind === 'caregiver' ? eq(sessions.caregiverId, w.caregiverId!) : and(eq(sessions.patientId, w.patientId), isNull(sessions.caregiverId))
  const ended = await tx.update(sessions).set({ revokedAt: new Date() })
    .where(and(mine, isNull(sessions.revokedAt), ne(sessions.id, w.sessionId))).returning({ id: sessions.id })
  return { first: !r?.hash, endedSessions: ended.length }
}

let dummyHash: Promise<string> | undefined // equalises timing when there is no password to check

export type PasswordLogin = { ok: true; login: PhoneLogin } | { ok: false; locked: boolean }

/**
 * Checks phone + password. Public route only (phoneLogins opens its own transactions). The answer for an unknown phone, a
 * phone with no password and a wrong password is the same; only a lock (after 5 wrong passwords on a real sign-in) differs.
 */
export async function checkPassword(phone: string, password: string, requestId: string): Promise<PasswordLogin> {
  const h = phoneHmac(phone)
  const m = h ? (await phoneLogins(h))[0] : undefined // ponytail: a number on several records opens the first (as for codes)
  const fake = async () => { await verifyPassword(password, await (dummyHash ??= hashPassword('not-a-real-password'))) }
  if (!m) { await fake(); return { ok: false, locked: false } }
  const w: Who = m.caregiverId ? { kind: 'caregiver', patientId: m.patientId, caregiverId: m.caregiverId } : { kind: 'patient', patientId: m.patientId }
  const t = table(w)
  const actor = { orgId: m.orgId, actorId: rowId(w), actorRole: w.kind, requestId }
  const [r] = await withOrg(m.orgId, (tx) => tx.select({ hash: t.passwordHash, locked: t.passwordLockedUntil }).from(t).where(eq(t.id, rowId(w))))
  const locked = !!r?.locked && r.locked > new Date()
  if (!r?.hash || locked) {
    await fake()
    if (r?.hash) await withOrg(m.orgId, (tx) => writeAudit(tx, { ...actor, action: 'auth.portal_password_failed', targetType: 'patient', targetId: m.patientId, details: { reason: 'locked' } }))
    return { ok: false, locked }
  }
  if (await verifyPassword(password, r.hash)) {
    await withOrg(m.orgId, (tx) => tx.update(t).set({ passwordFailed: 0, passwordLockedUntil: null }).where(eq(t.id, rowId(w))))
    return { ok: true, login: m }
  }
  // Atomic counter; a lock that has run out restarts the count (as for staff).
  const expired = sql`(${t.passwordLockedUntil} is not null and ${t.passwordLockedUntil} <= now())`
  const [u] = await withOrg(m.orgId, async (tx) => {
    const res = await tx.update(t).set({
      passwordFailed: sql`case when ${expired} then 1 else ${t.passwordFailed} + 1 end`,
      passwordLockedUntil: sql`case when ${expired} then null when ${t.passwordFailed} + 1 >= ${MAX_FAILURES} then now() + interval '15 minutes' else ${t.passwordLockedUntil} end`,
    }).where(eq(t.id, rowId(w))).returning({ failed: t.passwordFailed })
    await writeAudit(tx, { ...actor, action: 'auth.portal_password_failed', targetType: 'patient', targetId: m.patientId, details: { reason: 'password', locked: res[0].failed >= MAX_FAILURES } })
    return res
  })
  return { ok: false, locked: u.failed >= MAX_FAILURES }
}
