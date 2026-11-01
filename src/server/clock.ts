import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { orgSettings } from '@/db/schema'
import { isDemo } from './demo'

/**
 * Authoritative "now" for business time (reminders, due dates, radar windows).
 * In DEMO_MODE an org's clock can be fast-forwarded via org_settings.demo_clock_offset_s.
 * Session expiry deliberately uses real time, so fast-forwarding never logs anyone out.
 */
export async function now(orgId?: string): Promise<Date> {
  const real = Date.now()
  if (!orgId || !isDemo()) return new Date(real)
  const [row] = await db.select({ s: orgSettings.demoClockOffsetS }).from(orgSettings).where(eq(orgSettings.orgId, orgId))
  return new Date(real + (row?.s ?? 0) * 1000)
}
