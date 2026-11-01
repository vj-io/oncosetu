import { and, desc, eq, gte, isNull } from 'drizzle-orm'
import { encounters, patients } from '@/db/schema'
import { now } from '@/server/clock'
import { decryptField } from '@/server/crypto'
import { route } from '@/server/http'
import { activeConsent, ageYears } from '@/server/patients'

const IST_MS = 5.5 * 3600_000
/** Start of the current calendar day in India (the clinic's day), as a UTC instant. */
const startOfIstDay = (t: Date) => new Date(Math.floor((t.getTime() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS)

// Who the capture desk can attach pages to: encounters opened today at this org, patient active, consent to store.
// The app encrypts this list on the device (behind the PIN) so capture keeps working offline.
export const GET = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'] }, async (ctx) => {
  const t = await now(ctx.session.orgId)
  const rows = await ctx.db.select({
    encounterId: encounters.id, patientId: encounters.patientId, type: encounters.type, startedAt: encounters.startedAt,
    nameEnc: patients.nameEnc, dobEnc: patients.dobEnc, mrn: patients.mrn,
  }).from(encounters).innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(and(
      gte(encounters.startedAt, startOfIstDay(t)), isNull(encounters.closedAt),
      eq(patients.status, 'active'), eq(patients.deceased, false),
    )).orderBy(desc(encounters.startedAt)).limit(200)

  const items = []
  for (const r of rows) {
    if (!(await activeConsent(ctx.db, r.patientId))?.purposes.store) continue
    items.push({
      encounterId: r.encounterId, patientId: r.patientId, type: r.type, startedAt: r.startedAt.toISOString(),
      name: decryptField(r.nameEnc), mrn: r.mrn, ageYears: r.dobEnc ? ageYears(decryptField(r.dobEnc)) : null,
    })
  }
  await ctx.audit('capture.list', null, null, { count: items.length })
  return { generatedAt: t.toISOString(), items }
})
