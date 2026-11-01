import { z } from 'zod'
import { HttpError, route } from '@/server/http'
import { resetStaffTotp, setStaffActive, setStaffRole } from '@/server/admin/staff'
import { zRole, zUuid } from '@/server/admin/schemas'

export const POST = route({
  auth: 'staff', roles: ['org_admin'],
  body: z.discriminatedUnion('action', [
    z.object({ action: z.literal('deactivate') }),
    z.object({ action: z.literal('reactivate') }),
    z.object({ action: z.literal('reset_totp') }),
    z.object({ action: z.literal('set_role'), role: zRole }),
  ]),
}, async (ctx) => {
  const id = zUuid.safeParse(ctx.params.id)
  if (!id.success) throw new HttpError(404, 'not_found', 'Not found')
  const b = ctx.body
  if (b.action === 'reset_totp') return resetStaffTotp(ctx, id.data)
  if (b.action === 'set_role') await setStaffRole(ctx, id.data, b.role)
  else await setStaffActive(ctx, id.data, b.action === 'reactivate')
  return { ok: true }
})
