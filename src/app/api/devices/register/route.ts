import { z } from 'zod'
import { devices } from '@/db/schema'
import { route } from '@/server/http'

// FR-OFF-06: every capture tablet is a row an org_admin can revoke.
export const POST = route({
  auth: 'staff',
  roles: ['desk', 'records', 'clinician', 'org_admin'],
  body: z.object({ label: z.string().trim().min(1).max(80) }),
}, async (ctx) => {
  const [d] = await ctx.db.insert(devices)
    .values({ orgId: ctx.session.orgId, label: ctx.body.label, registeredBy: ctx.session.staffId })
    .returning({ id: devices.id })
  await ctx.audit('device.register', 'device', d.id)
  return { deviceId: d.id }
})
