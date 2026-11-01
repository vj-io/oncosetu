// Client-only: device registration, revocation checks, and the full local wipe (FR-OFF-06, E-OFF-05).
import { clearDevice, getDevice, setDevice, wipeAll, type DeviceInfo } from './store'

const json = { 'content-type': 'application/json' }

/** Register this tablet once (needs the network). Returns null while offline or signed out; retried on the next contact. */
export async function ensureDevice(label: string): Promise<DeviceInfo | null> {
  const have = getDevice()
  if (have) return have
  try {
    const res = await fetch('/api/devices/register', { method: 'POST', headers: json, body: JSON.stringify({ label }) })
    if (!res.ok) return null
    const d = { deviceId: ((await res.json()) as { deviceId: string }).deviceId, label }
    setDevice(d)
    return d
  } catch {
    return null
  }
}

/** 'revoked' = the server says wipe. 'unknown' = could not ask (offline, signed out): keep the queue. */
export async function checkDevice(deviceId: string): Promise<'active' | 'revoked' | 'unknown'> {
  try {
    const res = await fetch('/api/devices/status', { headers: { 'x-device-id': deviceId }, cache: 'no-store' })
    if (!res.ok) return 'unknown'
    return ((await res.json()) as { status: 'active' | 'revoked' }).status
  } catch {
    return 'unknown'
  }
}

/** Revoked device: tell the server the wipe happened (best effort), then remove the key, queue, list and device id. */
export async function wipeRevokedDevice(): Promise<void> {
  const d = getDevice()
  if (d) await checkDevice(d.deviceId) // the status route records wiped_at
  await wipeAll()
  clearDevice()
}
