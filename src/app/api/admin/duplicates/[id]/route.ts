import { z } from 'zod'
import { HttpError, route } from '@/server/http'
import { approveMerge, rejectMerge } from '@/server/admin/duplicates'
import { recomputeAffected } from '@/server/admin/radar-recompute'
import { zUuid } from '@/server/admin/schemas'

export const POST = route({
  auth: 'staff', roles: ['records', 'org_admin'],
  body: z.object({ action: z.enum(['approve', 'reject']) }),
}, async (ctx) => {
  const id = zUuid.safeParse(ctx.params.id)
  if (!id.success) throw new HttpError(404, 'not_found', 'Not found')
  if (ctx.body.action === 'reject') {
    await rejectMerge(ctx, id.data)
    return { ok: true }
  }
  const r = await approveMerge(ctx, id.data)
  await recomputeAffected(ctx.db, ctx.session.orgId, [r.survivorId])
  return { ok: true, moved: r.moved }
})
