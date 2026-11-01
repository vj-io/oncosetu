import { z } from 'zod'
import { route } from '@/server/http'
import { requestMerge } from '@/server/admin/duplicates'
import { zUuid } from '@/server/admin/schemas'

// E-ID-06: first approval. A different staff member must approve at POST /api/admin/duplicates/[id].
export const POST = route({
  auth: 'staff', roles: ['records', 'org_admin'],
  body: z.object({ survivorId: zUuid, duplicateId: zUuid, reason: z.string().trim().max(300).optional() }),
}, (ctx) => requestMerge(ctx, ctx.body))
