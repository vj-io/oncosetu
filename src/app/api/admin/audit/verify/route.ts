import { route } from '@/server/http'
import { verifyAuditChain } from '@/server/audit'

// "Verify chain": walks the whole org chain and reports intact, or the first broken seq.
export const POST = route({ auth: 'staff', roles: ['org_admin', 'auditor'] }, async (ctx) => {
  const r = await verifyAuditChain(ctx.session.orgId)
  await ctx.audit('audit.verify_chain', 'audit_log', null, { ok: r.ok, checked: r.checked, ...(r.brokenAt ? { brokenAt: r.brokenAt } : {}) })
  return r
})
