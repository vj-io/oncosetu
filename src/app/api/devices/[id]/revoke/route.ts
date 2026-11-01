import { and, eq, isNull } from 'drizzle-orm'
import { devices } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { isUuid } from '@/server/devices/check'

// FR-OFF-06 / E-OFF-05: org_admin revokes a device; its next contact gets 410 device_revoked and wipes the queue.
export const POST = route({ auth: 'staff', roles: ['org_admin'] }, async (ctx) => {
  const id = String(ctx.params.id)
  if (!isUuid(id)) throw new HttpError(404, 'not_found', 'Not found')
  const rows = await ctx.db.update(devices).set({ revokedAt: new Date() })
    .where(and(eq(devices.id, id), eq(devices.orgId, ctx.session.orgId), isNull(devices.revokedAt)))
    .returning({ id: devices.id })
  if (!rows.length) {
    const [d] = await ctx.db.select({ id: devices.id }).from(devices).where(and(eq(devices.id, id), eq(devices.orgId, ctx.session.orgId)))
    if (!d) throw new HttpError(404, 'not_found', 'Not found')
    return { ok: true, alreadyRevoked: true }
  }
  await ctx.audit('device.revoke', 'device', id)
  return { ok: true }
})
