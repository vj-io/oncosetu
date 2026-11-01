// Device checks for the offline capture app (FR-OFF-06, E-OFF-05).
// The Pipeline upload route calls assertDeviceActive() with the `x-device-id` header.
import { and, eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { devices } from '@/db/schema'
import { HttpError } from '@/server/http'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string) => UUID.test(s)
const LAST_SEEN_EVERY_MS = 60_000

export type DeviceStatus = 'active' | 'revoked'

/** Unknown ids (other org, deleted, malformed) count as revoked: the client must wipe either way. */
export async function deviceStatus(tx: Tx, orgId: string, deviceId: string): Promise<DeviceStatus> {
  if (!isUuid(deviceId)) return 'revoked'
  const [d] = await tx.select({ revokedAt: devices.revokedAt, lastSeenAt: devices.lastSeenAt }).from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.orgId, orgId)))
  if (!d || d.revokedAt) return 'revoked'
  if (!d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > LAST_SEEN_EVERY_MS) {
    await tx.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, deviceId))
  }
  return 'active'
}

/** `null` = upload from a browser that is not a registered capture device (allowed). Throws 410 device_revoked otherwise. */
export async function assertDeviceActive(tx: Tx, orgId: string, deviceId: string | null): Promise<void> {
  if (!deviceId) return
  if ((await deviceStatus(tx, orgId, deviceId)) === 'revoked') {
    throw new HttpError(410, 'device_revoked', 'This device was revoked; its local queue must be wiped')
  }
}
