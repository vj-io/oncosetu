// ASVS 3.3.3 / 3.3.4: a staff member sees their own live sign-ins and can end every one but the current.
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import { sessions } from '@/db/schema'
import type { StaffSession } from './session'

export type OwnSession = { id: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date; current: boolean }

/** Not revoked, not past the maximum, not idle past its timeout: the same rule sessionFromToken applies. */
const live = (staffId: string) => and(
  eq(sessions.staffId, staffId), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`),
  gt(sql`${sessions.lastSeenAt} + make_interval(secs => ${sessions.idleTimeoutS})`, sql`now()`),
)

export async function listOwnSessions(s: StaffSession): Promise<OwnSession[]> {
  const rows = await db.select({ id: sessions.id, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
    .from(sessions).where(live(s.staffId)).orderBy(desc(sessions.lastSeenAt))
  return rows.map((r) => ({ ...r, current: r.id === s.sessionId }))
}

/** Ends every live sign-in of this staff member except the one making the request. Returns how many ended. */
export async function revokeOtherSessions(s: StaffSession): Promise<number> {
  const ended = await db.update(sessions).set({ revokedAt: new Date() })
    .where(and(live(s.staffId), ne(sessions.id, s.sessionId))).returning({ id: sessions.id })
  return ended.length
}
