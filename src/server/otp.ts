// Phone OTP: 6 digits, hashed at rest, 5 min expiry, 5 failed attempts → phone locked 15 min. Uniform failures.
import { randomInt } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { db, withOrg, type Tx } from '@/db'
import { otpChallenges, patients } from '@/db/schema'
import { hmac, timingSafeEqualStr } from './crypto'

export const OTP_TTL_MS = 5 * 60_000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_LOCK_MS = 15 * 60_000

type Challenge = { id: string; codeHash: string; attempts: number; lockedUntil: Date | null; expiresAt: Date; consumedAt: Date | null }

export const otpCodeHash = (challengeId: string, code: string) => hmac(`otp:${challengeId}:${code}`)

export const isLocked = (c: Pick<Challenge, 'lockedUntil'> | undefined, now: Date) => !!c?.lockedUntil && c.lockedUntil > now

/** Pure decision for one verify attempt. `update` is what to persist on the challenge. */
export function evaluateOtpAttempt(c: Challenge | undefined, code: string, now: Date):
  { ok: boolean; update?: Partial<Pick<Challenge, 'attempts' | 'lockedUntil' | 'consumedAt'>> } {
  if (!c || isLocked(c, now) || c.consumedAt || c.expiresAt <= now) return { ok: false }
  if (/^\d{6}$/.test(code) && timingSafeEqualStr(otpCodeHash(c.id, code), c.codeHash)) {
    return { ok: true, update: { consumedAt: now } }
  }
  const attempts = c.attempts + 1
  return { ok: false, update: attempts >= OTP_MAX_ATTEMPTS ? { attempts, lockedUntil: new Date(now.getTime() + OTP_LOCK_MS) } : { attempts } }
}

async function latest(q: Tx | typeof db, phoneHmac: string, purpose: string, lock = false) {
  const base = q.select().from(otpChallenges)
    .where(and(eq(otpChallenges.phoneHmac, phoneHmac), eq(otpChallenges.purpose, purpose)))
    .orderBy(desc(otpChallenges.createdAt)).limit(1)
  const [c] = lock ? await base.for('update') : await base
  return c
}

/** Issues a new code, or null while the phone is locked (caller still answers 200). */
export async function startOtp(phoneHmac: string, purpose = 'login'): Promise<{ code: string } | null> {
  const now = new Date()
  const prev = await latest(db, phoneHmac, purpose)
  if (isLocked(prev, now)) return null
  // Failed attempts carry over to a re-issued code for 15 min, so re-requesting never resets the counter.
  const carried = prev && !prev.consumedAt && now.getTime() - prev.createdAt.getTime() < OTP_LOCK_MS ? prev.attempts : 0
  const id = uuidv7()
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await db.insert(otpChallenges).values({
    id, phoneHmac, purpose, codeHash: otpCodeHash(id, code), attempts: carried,
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
  })
  return { code }
}

/** Checks the latest challenge for the phone. Lock state carries over to new challenges via startOtp. */
export async function verifyOtp(phoneHmac: string, code: string, purpose = 'login'): Promise<boolean> {
  return db.transaction(async (tx) => {
    const c = await latest(tx, phoneHmac, purpose, true) // row lock: parallel guesses are counted one by one
    const res = evaluateOtpAttempt(c, code, new Date())
    if (c && res.update) await tx.update(otpChallenges).set(res.update).where(eq(otpChallenges.id, c.id))
    return res.ok
  })
}

export type PhoneLogin = { patientId: string; orgId: string; caregiverId: string | null; preferredLanguage: 'en' | 'hi' }

/**
 * Which patient records this phone may open. A patient's own phone is excluded when the caregiver is the
 * primary contact (FR-CON-07) or the patient is a minor (FR-CON-03); deceased patients are closed (E-ID-11).
 */
export async function phoneLogins(phoneHmac: string): Promise<PhoneLogin[]> {
  const rows = await db.execute<{ patient_id: string; org_id: string; caregiver_id: string | null }>(
    sql`select * from resolve_patients_by_phone(${phoneHmac})`)
  const out: PhoneLogin[] = []
  for (const r of rows) {
    const p = await withOrg(r.org_id, async (tx) => (await tx.select({
      primaryContact: patients.primaryContact, minor: patients.minor, deceased: patients.deceased, lang: patients.preferredLanguage,
    }).from(patients).where(eq(patients.id, r.patient_id)))[0])
    if (!p || p.deceased) continue
    if (!r.caregiver_id && (p.primaryContact === 'caregiver' || p.minor)) continue
    out.push({ patientId: r.patient_id, orgId: r.org_id, caregiverId: r.caregiver_id, preferredLanguage: p.lang })
  }
  return out
}
