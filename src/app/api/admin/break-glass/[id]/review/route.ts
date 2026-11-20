import { HttpError, route } from '@/server/http'
import { reviewBreakGlass } from '@/server/admin/ops'
import { zUuid } from '@/server/admin/schemas'

// FR-ID-10: another administrator marks (or, with no other administrator, an auditor) a break-glass grant reviewed, which clears it from the /admin alert.
export const POST = route({ auth: 'staff', roles: ['org_admin', 'auditor'] }, async (ctx) => {
  const id = zUuid.safeParse(ctx.params.id)
  if (!id.success) throw new HttpError(404, 'not_found', 'Not found')
  await reviewBreakGlass(ctx, id.data)
  return { ok: true }
})
