// J8 / PRD §10.5: org_admin executes one due erasure request. The DB function refuses anything not yet due.
import { zUuid } from '@/server/admin/schemas'
import { executeErasure } from '@/server/erasure/erasure'
import { HttpError, route } from '@/server/http'

export const POST = route({ auth: 'staff', roles: ['org_admin'] }, async (ctx) => {
  const id = zUuid.safeParse(ctx.params.id)
  if (!id.success) throw new HttpError(404, 'not_found', 'Not found')
  return { ok: true, ...(await executeErasure(ctx, id.data)) }
})
