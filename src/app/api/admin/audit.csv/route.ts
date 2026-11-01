import { z } from 'zod'
import { route } from '@/server/http'
import { exportAudit } from '@/server/admin/audit-view'

// FR-ADM-02: CSV of the filtered audit log. Ids only; the export itself is audited.
export const GET = route({
  auth: 'staff', roles: ['org_admin', 'auditor'],
  query: z.object({ actor: z.string().max(40).optional(), action: z.string().max(100).optional(), type: z.string().max(60).optional(), from: z.string().max(10).optional(), to: z.string().max(10).optional() }),
}, async (ctx) => {
  const q = ctx.query
  const { csv, count, truncated } = await exportAudit(ctx.db, ctx.session.orgId, { actorId: q.actor, action: q.action, targetType: q.type, from: q.from, to: q.to })
  await ctx.audit('audit.export', 'audit_log', null, { rows: count, truncated })
  return new Response(csv, { headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
  } })
})
