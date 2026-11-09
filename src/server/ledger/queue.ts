// Records work queue across patients (FR-ONB-01, FR-VER-02): identity decisions, low-confidence pages, unverified
// items by onboarding priority. Patients without an active 'store' consent are counted, never named.
import { and, count, eq, inArray, isNull, notExists, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Tx } from '@/db'
import { consents, documentPages, documents, events, patients, type ConsentPurposes } from '@/db/schema'
import { decryptField } from '../crypto'
import { PRIORITY_BUCKETS, priorityOf } from './core'

export type QueueRow = {
  patientId: string; name: string; accession: string; mrn: string | null
  identity: number; lowConfidence: number; unverified: number[] // per PRIORITY_BUCKETS index
  firstBucket: number; total: number
}

const accession = (id: string) => `OS·${id.replace(/-/g, '').slice(-6).toUpperCase()}`

/** Rows shown at once. The tallies count every patient; only the shown rows' names are decrypted (NFR scale: 2,000 patients). */
export const QUEUE_PAGE = 100

export type QueueTotals = { patients: number; identity: number; lowConfidence: number; unverified: number }

/** Active patients among `ids` and which of them have an active 'store' consent (the rest may be counted, never named). */
export async function peopleWithConsent(tx: Tx, ids: string[]) {
  const [people, latest] = await Promise.all([
    tx.select({ id: patients.id, nameEnc: patients.nameEnc, mrn: patients.mrn, status: patients.status }).from(patients).where(inArray(patients.id, ids)),
    tx.selectDistinctOn([consents.patientId], { patientId: consents.patientId, action: consents.action, purposes: consents.purposes })
      .from(consents).where(inArray(consents.patientId, ids)).orderBy(consents.patientId, sql`${consents.recordedAt} desc`, sql`${consents.id} desc`),
  ])
  return { people, consented: new Set(latest.filter((c) => c.action !== 'withdraw' && (c.purposes as ConsentPurposes).store).map((c) => c.patientId)) }
}

export async function loadRecordsQueue(tx: Tx, limit = QUEUE_PAGE): Promise<{ rows: QueueRow[]; totals: QueueTotals; withoutConsent: number; buckets: readonly string[] }> {
  const next = alias(events, 'next_version')
  const [identity, lowConf, unverified] = await Promise.all([
    tx.select({ patientId: documents.patientId, n: count() }).from(documents)
      .where(eq(documents.attachState, 'pending_decision')).groupBy(documents.patientId),
    tx.select({ patientId: documents.patientId, n: count() }).from(documentPages)
      .innerJoin(documents, eq(documents.id, documentPages.documentId))
      .where(and(eq(documentPages.lowConfidence, true), isNull(documentPages.supersededAt), inArray(documents.attachState, ['auto', 'attached']))).groupBy(documents.patientId),
    tx.select({ patientId: events.patientId, docType: documents.docType, n: count() }).from(events)
      .leftJoin(documents, eq(documents.id, events.documentId))
      .where(and(
        eq(events.verificationStatus, 'unverified'), isNull(events.withdrawnAt), sql`${events.eventType} <> 'patient_statement'`,
        or(isNull(events.documentId), inArray(documents.attachState, ['auto', 'attached'])),
        notExists(tx.select({ x: sql`1` }).from(next).where(eq(next.supersedesId, events.id))),
      )).groupBy(events.patientId, documents.docType),
  ])
  const byPatient = new Map<string, QueueRow>()
  const row = (id: string) => {
    let r = byPatient.get(id)
    if (!r) byPatient.set(id, (r = { patientId: id, name: '', accession: accession(id), mrn: null, identity: 0, lowConfidence: 0, unverified: PRIORITY_BUCKETS.map(() => 0), firstBucket: 99, total: 0 }))
    return r
  }
  for (const x of identity) row(x.patientId).identity = x.n
  for (const x of lowConf) row(x.patientId).lowConfidence = x.n
  for (const x of unverified) {
    const r = row(x.patientId)
    const b = priorityOf(x.docType)
    r.unverified[b] += x.n
    r.firstBucket = Math.min(r.firstBucket, b)
  }
  const ids = [...byPatient.keys()]
  const totals: QueueTotals = { patients: 0, identity: 0, lowConfidence: 0, unverified: 0 }
  if (!ids.length) return { rows: [], totals, withoutConsent: 0, buckets: PRIORITY_BUCKETS }

  const { people, consented } = await peopleWithConsent(tx, ids)
  let withoutConsent = 0
  const rows: QueueRow[] = []
  const nameEnc = new Map<string, string>()
  for (const p of people) {
    if (p.status !== 'active') continue
    if (!consented.has(p.id)) { withoutConsent++; continue }
    const r = byPatient.get(p.id)!
    nameEnc.set(p.id, p.nameEnc)
    r.mrn = p.mrn
    const unverified = r.unverified.reduce((a, b) => a + b, 0)
    r.total = r.identity + r.lowConfidence + unverified
    totals.patients++; totals.identity += r.identity; totals.lowConfidence += r.lowConfidence; totals.unverified += unverified
    rows.push(r)
  }
  // Administrative order (FR-ONB-01): pending identity decisions first, then the highest-priority document type waiting, then volume.
  rows.sort((a, b) => Number(b.identity > 0) - Number(a.identity > 0) || a.firstBucket - b.firstBucket || b.total - a.total || a.accession.localeCompare(b.accession))
  const shown = rows.slice(0, limit)
  for (const r of shown) r.name = decryptField(nameEnc.get(r.patientId)!)
  return { rows: shown, totals, withoutConsent, buckets: PRIORITY_BUCKETS }
}
