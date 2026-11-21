// ASVS 2.1.5 / 2.1.6: a staff member changes their own password. The current password is required; wrong guesses count
// toward the same lock as sign-in (5 → 15 minutes), on `sideDb` so the count survives the request's rollback (POOL RULE,
// src/db/index.ts); after a change every other sign-in of the account ends. Shared demo accounts keep their password.
import { and, eq, sql } from 'drizzle-orm'
import { sideDb } from '@/db'
import { staff } from '@/db/schema'
import type { AuditDetails } from './audit'
import { hashPassword, verifyPassword } from './crypto'
import { revokeOtherSessions } from './own-sessions'
import type { StaffSession } from './session'

export const MIN_PASSWORD = 12
const MAX_FAILURES = 5 // as at sign-in (src/app/api/auth/staff/login/route.ts)

/** Why a new password is refused, or null. Pure. */
export function newPasswordProblem(current: string, next: string): string | null {
  if (next.length < MIN_PASSWORD) return `The new password needs at least ${MIN_PASSWORD} characters`
  if (next === current) return 'The new password must be different from the current one'
  return null
}

export type ChangeResult =
  | { ok: true; ended: number }
  | { ok: false; status: number; code: string; message: string; audit?: { action: string; details: AuditDetails } }

export async function changeOwnPassword(s: StaffSession, current: string, next: string): Promise<ChangeResult> {
  const [row] = await sideDb.select().from(staff).where(eq(staff.id, s.staffId))
  if (!row || !row.active) return { ok: false, status: 403, code: 'forbidden', message: 'Not allowed' }
  if (row.isDemo) return { ok: false, status: 403, code: 'demo_account', message: 'Demo accounts share one password, so it cannot be changed here' }
  if (row.lockedUntil && row.lockedUntil > new Date()) return { ok: false, status: 403, code: 'locked', message: 'Too many wrong passwords. Try again in 15 minutes' }
  if (!(await verifyPassword(current, row.passwordHash))) {
    const expired = sql`(${staff.lockedUntil} is not null and ${staff.lockedUntil} <= now())`
    const [u] = await sideDb.update(staff).set({
      failedLogins: sql`case when ${expired} then 1 else ${staff.failedLogins} + 1 end`,
      lockedUntil: sql`case when ${expired} then null when ${staff.failedLogins} + 1 >= ${MAX_FAILURES} then now() + interval '15 minutes' else ${staff.lockedUntil} end`,
    }).where(eq(staff.id, s.staffId)).returning({ failed: staff.failedLogins })
    return {
      ok: false, status: 403, code: 'wrong_password', message: 'The current password is not right',
      audit: { action: 'auth.password_change_failed', details: { locked: u.failed >= MAX_FAILURES } },
    }
  }
  const problem = newPasswordProblem(current, next)
  if (problem) return { ok: false, status: 400, code: 'weak_password', message: problem }
  const [done] = await sideDb.update(staff).set({ passwordHash: await hashPassword(next), failedLogins: 0, lockedUntil: null })
    .where(and(eq(staff.id, s.staffId), eq(staff.passwordHash, row.passwordHash))).returning({ id: staff.id }) // not if it changed meanwhile
  if (!done) return { ok: false, status: 409, code: 'changed_meanwhile', message: 'Your password was changed elsewhere. Sign in again' }
  return { ok: true, ended: await revokeOtherSessions(s) }
}
