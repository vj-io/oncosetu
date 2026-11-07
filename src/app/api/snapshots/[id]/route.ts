import { eq } from 'drizzle-orm'
import { snapshots } from '@/db/schema'
import { HttpError, route } from '@/server/http'
import { snapshotFile } from '@/server/ledger/export'
import { idParam } from '@/server/ledger/verify'
import { assertPatientAccess } from '@/server/patients'

// The sealed snapshot as a file, for the offline check (scripts/verify-snapshot.ts, FR-PAS-05). It is the whole sealed
// record, staff-only lines included, so records officers and clinicians only: never a patient or a share link.
export const GET = route({ auth: 'staff', roles: ['records', 'clinician'] }, async (ctx) => {
  const id = idParam(ctx)
  const [row] = await ctx.db.select().from(snapshots).where(eq(snapshots.id, id))
  if (!row) throw new HttpError(404, 'not_found', 'Not found')
  await assertPatientAccess(ctx, row.patientId)
  await ctx.audit('snapshot.download', 'patient', row.patientId, { snapshotId: id }) // in the patient's access log, as an export
  return new Response(JSON.stringify(snapshotFile(row), null, 2), {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="snapshot-${id}.json"` },
  })
})
