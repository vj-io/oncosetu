// Cookie sessions. The cookie holds a random token; the DB stores only its SHA-256.
// Staff: 12 h max, 30 min idle (FR-ID-09). Patient/caregiver: 2 h max, 30 min idle.
// Expiry uses real time (not the demo clock), so fast-forwarding an org never logs anyone out.
import { and, eq, isNull } from 'drizzle-orm'
import { cookies, headers } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'
import { cache } from 'react'
import { db, withOrg } from '@/db'
import { caregivers, organisations, patients, sessions, staff } from '@/db/schema'
import { decryptField, randomToken, sha256Hex } from './crypto'
import type { Role, StaffRole } from './rbac'

export const SESSION_COOKIE = 'os_sid'
/**
 * ASVS 3.4.4: wherever the cookie is Secure it is named `__Host-os_sid`, so the browser refuses one set by another
 * subdomain or over http, and only that name is read there. Plain-http localhost (E2E) keeps `os_sid`: the prefix needs Secure.
 */
export const sessionCookieName = (secure: boolean) => (secure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE)
const requestCookieName = async () => { const h = await headers(); return sessionCookieName(cookieSecure(h.get('host'), h.get('x-forwarded-proto'))) }
const LIMITS = {
  staff: { maxS: 12 * 3600, idleS: 30 * 60 },
  patient: { maxS: 2 * 3600, idleS: 30 * 60 },
  caregiver: { maxS: 2 * 3600, idleS: 30 * 60 },
  /** A shared desk-station tablet (FR-VOX-02): short, so the next person never finds the last one signed in. */
  station: { maxS: 30 * 60, idleS: 5 * 60 },
} as const
const TOUCH_AFTER_MS = 60_000

export type StaffSession = {
  kind: 'staff'; sessionId: string; staffId: string; role: StaffRole; orgId: string; orgName: string
  staffName: string; email: string
}
export type PatientSession = {
  kind: 'patient' | 'caregiver'; sessionId: string; patientId: string; orgId: string; caregiverId?: string
  displayName: string
}
export type Session = StaffSession | PatientSession

export const sessionRole = (s: Session): Role => (s.kind === 'staff' ? s.role : s.kind)

/** Resolve a raw cookie token to a live session, or null. Exported for tests. */
export async function sessionFromToken(token: string): Promise<Session | null> {
  const [row] = await db.select().from(sessions)
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt)))
  if (!row) return null
  const t = Date.now()
  if (row.expiresAt.getTime() <= t || row.lastSeenAt.getTime() + row.idleTimeoutS * 1000 <= t) return null

  let session: Session | null = null
  if (row.kind === 'staff' && row.staffId) {
    const [s] = await db.select({ staff, orgName: organisations.name }).from(staff)
      .innerJoin(organisations, eq(organisations.id, staff.orgId)).where(eq(staff.id, row.staffId))
    if (s?.staff.active && s.staff.orgId === row.orgId) {
      session = {
        kind: 'staff', sessionId: row.id, staffId: s.staff.id, role: s.staff.role, orgId: row.orgId,
        orgName: s.orgName, staffName: s.staff.name, email: s.staff.email,
      }
    }
  } else if (row.patientId) {
    session = await withOrg(row.orgId, async (tx) => {
      const [p] = await tx.select({ status: patients.status, deceased: patients.deceased, nameEnc: patients.nameEnc })
        .from(patients).where(eq(patients.id, row.patientId!))
      if (!p || p.status !== 'active' || p.deceased) return null
      if (row.kind === 'caregiver') {
        const [c] = row.caregiverId ? await tx.select().from(caregivers)
          .where(and(eq(caregivers.id, row.caregiverId), eq(caregivers.patientId, row.patientId!))) : []
        if (!c || !c.active || c.revokedAt) return null // revoked caregiver: denied on the next request
        return { kind: 'caregiver', sessionId: row.id, patientId: row.patientId!, orgId: row.orgId, caregiverId: c.id, displayName: decryptField(c.nameEnc) }
      }
      return { kind: 'patient', sessionId: row.id, patientId: row.patientId!, orgId: row.orgId, displayName: decryptField(p.nameEnc) }
    })
  }
  if (session && t - row.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date(t) }).where(eq(sessions.id, row.id))
  }
  return session
}

/** Current session (memoised per request), or null. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(await requestCookieName())?.value
  return token ? sessionFromToken(token) : null
})

/** For server components/pages. Redirects to /login; renders the 403 page if the role is not allowed. */
export async function requireStaff(roles?: readonly StaffRole[]): Promise<StaffSession> {
  const s = await getSession()
  if (!s || s.kind !== 'staff') redirect('/login')
  if (roles?.length && !roles.includes(s.role)) forbidden()
  return s
}

export async function requirePatientSession(): Promise<PatientSession> {
  const s = await getSession()
  if (!s || s.kind === 'staff') redirect('/p/login')
  return s
}

export type CreateSessionInput =
  | { kind: 'staff'; staffId: string; orgId: string }
  | { kind: 'patient'; patientId: string; orgId: string; station?: boolean }
  | { kind: 'caregiver'; patientId: string; caregiverId: string; orgId: string; station?: boolean }

/**
 * The session cookie is Secure wherever the app is deployed. The one exception is a production build served over plain
 * http on this machine (E2E): WebKit, unlike Chromium, drops a Secure cookie from http://localhost, so nobody could sign in.
 */
export function cookieSecure(host: string | null, proto: string | null, production = process.env.NODE_ENV === 'production'): boolean {
  if (!production) return false
  return proto === 'https' || !['localhost', '127.0.0.1', '[::1]'].includes((host ?? '').replace(/:\d+$/, ''))
}

/** Route handlers only (sets the cookie). */
export async function createSession(input: CreateSessionInput): Promise<{ sessionId: string; expiresAt: Date }> {
  const token = randomToken(32)
  const { maxS, idleS } = input.kind !== 'staff' && input.station ? LIMITS.station : LIMITS[input.kind]
  const expiresAt = new Date(Date.now() + maxS * 1000)
  const [row] = await db.insert(sessions).values({
    tokenHash: sha256Hex(token), kind: input.kind, orgId: input.orgId, expiresAt, idleTimeoutS: idleS,
    staffId: input.kind === 'staff' ? input.staffId : null,
    patientId: input.kind === 'staff' ? null : input.patientId,
    caregiverId: input.kind === 'caregiver' ? input.caregiverId : null,
  }).returning({ id: sessions.id })
  const h = await headers()
  const secure = cookieSecure(h.get('host'), h.get('x-forwarded-proto'))
  ;(await cookies()).set(sessionCookieName(secure), token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: maxS })
  return { sessionId: row.id, expiresAt }
}

/** Route handlers only. Revokes the current session row and clears the cookie. */
export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const name = await requestCookieName()
  const token = jar.get(name)?.value
  if (token) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256Hex(token)))
  jar.delete(name)
}
