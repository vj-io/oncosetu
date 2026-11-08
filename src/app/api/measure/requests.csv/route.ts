import { recordRequests } from '@/db/schema'
import { route } from '@/server/http'
import { requestOutcomesCsv } from '@/server/admin/metrics-compute'

// FR-REQ-06 study export: one row per records request — request id, kind of institution, state and dates. No patient id,
// no names (of people or institutions), no free text.
export const GET = route({ auth: 'staff', roles: ['org_admin', 'auditor'] }, async (ctx) => {
  const rows = await ctx.db.select({
    id: recordRequests.id, institutionType: recordRequests.institutionType, state: recordRequests.state,
    createdAt: recordRequests.createdAt, sentAt: recordRequests.sentAt, fulfilledAt: recordRequests.fulfilledAt,
  }).from(recordRequests)
  await ctx.audit('measurement.requests_export', 'record_request', null, { rows: rows.length })
  return new Response(requestOutcomesCsv(rows), { headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="request-outcomes-${new Date().toISOString().slice(0, 10)}.csv"`,
  } })
})
