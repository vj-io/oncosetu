import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, withOrg } from '@/db'
import { organisations, staff } from '@/db/schema'
import { writeAudit } from '@/server/audit'
import { decryptField, hashPassword, verifyPassword } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { createSession } from '@/server/session'
import { verifyTotp } from '@/server/totp'

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
  const totpOk = !s.totpEnabled || (!!s.totpSecretEnc && verifyTotp(decryptField(s.totpSecretEnc), body.totp.trim()))
  if (!pwOk || !totpOk) {
    // Atomic counter; 5 failures → 15 min lock (FR-ID-02 / FR-ID-09).
    const [u] = await db.update(staff).set({
      failedLogins: sql`${staff.failedLogins} + 1`,
      lockedUntil: sql`case when ${staff.failedLogins} + 1 >= ${MAX_FAILURES} then now() + interval '15 minutes' else ${staff.lockedUntil} end`,
    }).where(eq(staff.id, s.id)).returning({ failed: staff.failedLogins })
    await withOrg(s.orgId, (tx) => writeAudit(tx, {
      orgId: s.orgId, actorId: s.id, actorRole: s.role, action: 'auth.login_failed', targetType: 'staff', targetId: s.id,
      requestId, details: { reason: pwOk ? 'totp' : 'password', locked: u.failed >= MAX_FAILURES },
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
