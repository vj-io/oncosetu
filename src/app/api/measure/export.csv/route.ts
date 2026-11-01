import { route } from '@/server/http'
import { loadMeasureRows } from '@/server/admin/measurement'
import { measurementCsv } from '@/server/admin/measurement-core'

// Anonymised study export: no names, phones, dates of birth, encounter or clinician ids, or exact dates.
export const GET = route({ auth: 'staff', roles: ['org_admin', 'auditor'] }, async (ctx) => {
  const rows = await loadMeasureRows(ctx.db)
  await ctx.audit('measurement.export', 'measurement_form', null, { rows: rows.length })
  return new Response(measurementCsv(rows), { headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="measurement-study-${new Date().toISOString().slice(0, 10)}.csv"`,
  } })
})
