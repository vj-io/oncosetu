import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { consents, encounters, patients, type ConsentPurposes } from '@/db/schema'
import { now } from '@/server/clock'
import { decryptField } from '@/server/crypto'
import { route } from '@/server/http'
import { ageYears } from '@/server/patients'

const IST_MS = 5.5 * 3600_000
/** Start of the current calendar day in India (the clinic's day), as a UTC instant. */
const startOfIstDay = (t: Date) => new Date(Math.floor((t.getTime() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS)

const RECENT_DAYS = 30

// Who the capture desk can attach pages to: encounters opened today at this org, patient active, consent to store.
// Records and clinicians also get `recent`: patients seen in the last 30 days without an open visit today, for whom the
// device may open a new visit offline (FR-OFF-02). The desk does not: it opens a visit only by verifying the patient
// (FR-ID-02), and an offline-opened visit is not that, so the desk's list leaves those out too.
// The app encrypts this list on the device (behind the PIN) so capture keeps working offline.
export const GET = route({ auth: 'staff', roles: ['desk', 'records', 'clinician'] }, async (ctx) => {
  const t = await now(ctx.session.orgId)
  const desk = ctx.session.role === 'desk'
  const select = {
    encounterId: encounters.id, patientId: encounters.patientId, type: encounters.type, startedAt: encounters.startedAt,
    nameEnc: patients.nameEnc, dobEnc: patients.dobEnc, mrn: patients.mrn,
  }
  const live = and(eq(patients.status, 'active'), eq(patients.deceased, false))
  const rows = await ctx.db.select(select).from(encounters).innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(and(gte(encounters.startedAt, startOfIstDay(t)), isNull(encounters.closedAt), live, desk ? eq(encounters.offlineCreated, false) : undefined))
    .orderBy(desc(encounters.startedAt)).limit(200)
  const older = desk ? [] : await ctx.db.select(select).from(encounters).innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(and(gte(encounters.startedAt, new Date(t.getTime() - RECENT_DAYS * 86_400_000)), live))
    .orderBy(desc(encounters.startedAt)).limit(400)

  // consent to store, checked on use: the latest consent row of each patient, in one query (as activeConsent reads it)
  const ids = [...new Set([...rows, ...older].map((r) => r.patientId))]
  const latest = ids.length ? await ctx.db.selectDistinctOn([consents.patientId], { patientId: consents.patientId, action: consents.action, purposes: consents.purposes })
    .from(consents).where(inArray(consents.patientId, ids)).orderBy(consents.patientId, sql`${consents.recordedAt} desc`, sql`${consents.id} desc`) : []
  const stores = new Set(latest.filter((c) => c.action !== 'withdraw' && (c.purposes as ConsentPurposes).store).map((c) => c.patientId))
  const who = (r: (typeof rows)[number]) => ({ patientId: r.patientId, name: decryptField(r.nameEnc), mrn: r.mrn, ageYears: r.dobEnc ? ageYears(decryptField(r.dobEnc)) : null })
  const items = rows.filter((r) => stores.has(r.patientId)).map((r) => ({ encounterId: r.encounterId, type: r.type, startedAt: r.startedAt.toISOString(), ...who(r) }))
  const seen = new Set(items.map((i) => i.patientId))
  const recent = []
  for (const r of older) {
    if (seen.has(r.patientId) || recent.length >= 200) continue
    seen.add(r.patientId)
    if (stores.has(r.patientId)) recent.push({ lastVisitAt: r.startedAt.toISOString(), ...who(r) })
  }
  await ctx.audit('capture.list', null, null, { count: items.length, recent: recent.length })
  return { generatedAt: t.toISOString(), items, recent }
})
