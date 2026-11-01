import { and, eq, isNull } from 'drizzle-orm'
import { devices } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { deviceStatus, isUuid } from '@/server/devices/check'

// The capture app polls this when it comes online. 'revoked' tells it to wipe its queue (FR-OFF-06);
// the server records that it gave the instruction (wiped_at).
export const GET = route({ auth: 'staff' }, async (ctx) => {
  const deviceId = ctx.req.headers.get('x-device-id')
  if (!deviceId) throw new HttpError(400, 'invalid_request', 'x-device-id header required')
  const status = await deviceStatus(ctx.db, ctx.session.orgId, deviceId)
  if (status === 'revoked' && isUuid(deviceId)) { // a malformed id has no row to mark
    const wiped = await ctx.db.update(devices).set({ wipedAt: new Date() })
      .where(and(eq(devices.id, deviceId), eq(devices.orgId, ctx.session.orgId), isNull(devices.wipedAt)))
      .returning({ id: devices.id })
    if (wiped.length) await ctx.audit('device.wipe_ordered', 'device', deviceId)
  }
  return { status, deviceId }
})
