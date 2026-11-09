// FR-ADM-01: staff management. The staff table has no RLS, so every query filters by org explicitly.
import { and, asc, eq, isNull } from 'drizzle-orm'
import QRCode from 'qrcode'
import type { Tx } from '@/db'
import { sessions, staff } from '@/db/schema'
import { encryptField, hashPassword } from '../crypto'
import { HttpError } from '../http'
import type { StaffRole } from '../rbac'
import { generateTotpSecret, totpUri } from '../totp'
import type { AdminCtx } from './ctx'
import { wouldRemoveLastAdmin } from './staff-core'

export type StaffRow = {
  id: string; name: string; email: string; role: StaffRole; active: boolean; totpEnabled: boolean
  lastLoginAt: Date | null; createdAt: Date; isDemo: boolean; locked: boolean
}

export async function listStaff(tx: Tx, orgId: string): Promise<StaffRow[]> {
  const rows = await tx.select().from(staff).where(eq(staff.orgId, orgId)).orderBy(asc(staff.role), asc(staff.name))
  const t = Date.now()
  return rows.map((s) => ({
    id: s.id, name: s.name, email: s.email, role: s.role, active: s.active, totpEnabled: s.totpEnabled,
    lastLoginAt: s.lastLoginAt, createdAt: s.createdAt, isDemo: s.isDemo, locked: !!s.lockedUntil && s.lockedUntil.getTime() > t,
  }))
}

/** Shown exactly once, in the response that creates or resets it. Never stored in the clear. */
export type TotpEnrollment = { secret: string; uri: string; qrDataUrl: string }

async function enrol(email: string): Promise<{ enrollment: TotpEnrollment; secretEnc: string }> {
  const secret = generateTotpSecret()
  const uri = totpUri(secret, email)
  return { enrollment: { secret, uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 224 }) }, secretEnc: encryptField(secret) }
}

async function target(ctx: AdminCtx, id: string) {
  const [s] = await ctx.db.select().from(staff).where(and(eq(staff.id, id), eq(staff.orgId, ctx.session.orgId)))
  if (!s) throw new HttpError(404, 'not_found', 'Not found')
  return s
}

async function assertNotLastAdmin(ctx: AdminCtx, id: string, change: { role?: string; active?: boolean }) {
  const all = await ctx.db.select({ id: staff.id, role: staff.role, active: staff.active }).from(staff).where(eq(staff.orgId, ctx.session.orgId))
  if (wouldRemoveLastAdmin(all, id, change)) throw new HttpError(409, 'last_admin', 'The organisation must keep at least one active administrator')
}

export async function createStaff(ctx: AdminCtx, input: { name: string; email: string; role: StaffRole; password: string }) {
  const email = input.email.trim().toLowerCase()
  const [taken] = await ctx.db.select({ id: staff.id }).from(staff).where(eq(staff.email, email))
  if (taken) throw new HttpError(409, 'email_taken', 'That email address is already registered')
  const { enrollment, secretEnc } = await enrol(email)
  const [row] = await ctx.db.insert(staff).values({
    orgId: ctx.session.orgId, role: input.role, name: input.name.trim(), email, passwordHash: await hashPassword(input.password),
    totpSecretEnc: secretEnc, totpEnabled: true, active: true,
  }).returning({ id: staff.id })
  await ctx.audit('staff.create', 'staff', row.id, { role: input.role })
  return { id: row.id, enrollment }
}

export async function setStaffActive(ctx: AdminCtx, id: string, active: boolean) {
  const s = await target(ctx, id)
  if (!active && s.id === ctx.session.staffId) throw new HttpError(409, 'self_deactivate', 'You cannot deactivate your own account')
  if (s.active === active) return
  if (!active) await assertNotLastAdmin(ctx, id, { active })
  await ctx.db.update(staff).set(active ? { active, failedLogins: 0, lockedUntil: null } : { active }).where(eq(staff.id, id))
  if (!active) await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.staffId, id), isNull(sessions.revokedAt)))
  await ctx.audit(active ? 'staff.reactivate' : 'staff.deactivate', 'staff', id)
}

export async function setStaffRole(ctx: AdminCtx, id: string, role: StaffRole) {
  const s = await target(ctx, id)
  if (s.role === role) return
  await assertNotLastAdmin(ctx, id, { role })
  await ctx.db.update(staff).set({ role }).where(eq(staff.id, id))
  await ctx.audit('staff.role_change', 'staff', id, { from: s.role, to: role })
}

/** New secret, old one dead, live sessions revoked. */
export async function resetStaffTotp(ctx: AdminCtx, id: string) {
  const s = await target(ctx, id)
  const { enrollment, secretEnc } = await enrol(s.email)
  await ctx.db.update(staff).set({ totpSecretEnc: secretEnc, totpEnabled: true, totpLastStep: null, failedLogins: 0, lockedUntil: null }).where(eq(staff.id, id))
  await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.staffId, id), isNull(sessions.revokedAt)))
  await ctx.audit('staff.totp_reset', 'staff', id)
  return { id, enrollment }
}
