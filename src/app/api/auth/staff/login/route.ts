import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, withOrg } from '@/db'
import { organisations, staff } from '@/db/schema'
import { writeAudit } from '@/server/audit'
import { decryptField, hashPassword, verifyPassword } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { createSession } from '@/server/session'
import { demoTotpSecret, totpStep } from '@/server/totp'

const MAX_FAILURES = 5
let dummyHash: Promise<string> | undefined // equalises timing for unknown/locked accounts

export const POST = route({
  auth: 'public',
  body: z.object({ email: z.string().max(254), password: z.string().max(200), totp: z.string().max(12) }),
}, async ({ body, requestId }) => {
  const generic = new HttpError(401, 'invalid_credentials', 'Email, password or code is incorrect')
  const [s] = await db.select().from(staff).where(eq(staff.email, body.email.trim().toLowerCase()))
  const now = new Date()
  if (!s || !s.active || (s.lockedUntil && s.lockedUntil > now)) {
    await verifyPassword(body.password, await (dummyHash ??= hashPassword('not-a-real-password')))
    if (s) await withOrg(s.orgId, (tx) => writeAudit(tx, {
      orgId: s.orgId, actorId: s.id, actorRole: s.role, action: 'auth.login_failed', targetType: 'staff', targetId: s.id,
      requestId, details: { reason: s.active ? 'locked' : 'inactive' },
    }))
    throw generic
  }
  const pwOk = await verifyPassword(body.password, s.passwordHash)
  // Every staff account needs its authenticator (ASVS 2.7): no secret, no sign-in. A real authenticator's code is accepted
  // once (ASVS 2.8.4): the step of the last accepted code is stored and only a later step passes. The seeded demo and E2E
  // accounts' secrets are public (demoTotpSecret), so their codes are not tracked.
  const secret = s.totpSecretEnc ? decryptField(s.totpSecretEnc) : null
  const step = secret ? totpStep(secret, body.totp.trim()) : null
  let replay = false
  if (pwOk && step !== null && secret !== demoTotpSecret(s.email)) {
    const [used] = await db.update(staff).set({ totpLastStep: step })
      .where(and(eq(staff.id, s.id), or(isNull(staff.totpLastStep), lt(staff.totpLastStep, step)))).returning({ id: staff.id })
    replay = !used
  }
  const totpOk = step !== null && !replay
  if (!pwOk || !totpOk) {
    // Atomic counter; 5 failures → 15 min lock (FR-ID-02 / FR-ID-09). A lock that has run out restarts the count, so one
    // more typo after the lock is not an instant re-lock.
    const expired = sql`(${staff.lockedUntil} is not null and ${staff.lockedUntil} <= now())`
    const [u] = await db.update(staff).set({
      failedLogins: sql`case when ${expired} then 1 else ${staff.failedLogins} + 1 end`,
      lockedUntil: sql`case when ${expired} then null when ${staff.failedLogins} + 1 >= ${MAX_FAILURES} then now() + interval '15 minutes' else ${staff.lockedUntil} end`,
    }).where(eq(staff.id, s.id)).returning({ failed: staff.failedLogins })
    await withOrg(s.orgId, (tx) => writeAudit(tx, {
      orgId: s.orgId, actorId: s.id, actorRole: s.role, action: 'auth.login_failed', targetType: 'staff', targetId: s.id,
      requestId, details: { reason: pwOk ? (replay ? 'totp_reused' : 'totp') : 'password', locked: u.failed >= MAX_FAILURES },
    }))
    throw generic
  }
  await db.update(staff).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now }).where(eq(staff.id, s.id))
  const { sessionId } = await createSession({ kind: 'staff', staffId: s.id, orgId: s.orgId })
  await withOrg(s.orgId, (tx) => writeAudit(tx, {
    orgId: s.orgId, actorId: s.id, actorRole: s.role, action: 'auth.login', targetType: 'session', targetId: sessionId, requestId,
  }))
  const [org] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, s.orgId))
  return { ok: true, staff: { name: s.name, role: s.role, orgName: org?.name } }
})
