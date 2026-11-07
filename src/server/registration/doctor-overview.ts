// Read model for the clinician "First look" card and the oncology fact strip on the patient overview.
// Reads existing facts only (ledger, completeness checklist, held documents). Run inside withPatientAccess.
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents, events, missingRecords, snapshots } from '@/db/schema'
import { buildFirstLook, classifyHeld, type FirstLookRow, type HeldDoc } from '@/core/doctor/first-look'
import { dropDateOnlyImaging, oncologyView, type OncologyView } from '@/core/doctor/oncology'
import { DOC_TYPES, type DocType } from '@/core/types'
import { staffDocLabel } from '@/core/copy'
import { now } from '../clock'
import { buildLedgerView } from '../ledger/core'
import { latestSnapshot, loadRecordRows } from '../ledger/record'
import { loadCompleteness } from '../radar-ui/completeness'
import type { StaffSession } from '../session'

export type PatientGlance = { documents: number; notInFile: number; newSinceSeal: number; lastSealed: Date | null }

/** The four numbers a clinician scans on the patient list. One grouped query each, not one per patient. */
export async function patientGlances(tx: Tx, ids: string[]): Promise<Map<string, PatientGlance>> {
  const out = new Map<string, PatientGlance>(ids.map((id) => [id, { documents: 0, notInFile: 0, newSinceSeal: 0, lastSealed: null }]))
  if (!ids.length) return out
  const [docs, miss, seals] = await Promise.all([
    tx.select({ id: documents.patientId, n: sql<number>`count(*)::int` }).from(documents).where(and(inArray(documents.patientId, ids), inArray(documents.attachState, ['auto', 'attached']), isNull(documents.duplicateOf))).groupBy(documents.patientId),
    tx.select({ id: missingRecords.patientId, n: sql<number>`count(*)::int` }).from(missingRecords).where(and(inArray(missingRecords.patientId, ids), eq(missingRecords.mode, 'production'), inArray(missingRecords.state, ['expected', 'requested', 'received']))).groupBy(missingRecords.patientId),
    tx.select({ id: snapshots.patientId, at: sql<Date>`max(${snapshots.sealedAt})` }).from(snapshots).where(inArray(snapshots.patientId, ids)).groupBy(snapshots.patientId),
  ])
  for (const r of docs) out.get(r.id)!.documents = r.n
  for (const r of miss) out.get(r.id)!.notInFile = r.n
  for (const r of seals) out.get(r.id)!.lastSealed = new Date(r.at)
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)
  const fresh = await tx.execute<{ patient_id: string; n: number }>(sql`
    select e.patient_id, count(*) filter (where s.sealed is null or e.received_at > s.sealed)::int as n
    from events e left join (select patient_id, max(sealed_at) as sealed from snapshots group by patient_id) s on s.patient_id = e.patient_id
    where e.patient_id in (${idList}) and e.withdrawn_at is null and e.event_type <> 'patient_statement'
    group by e.patient_id`)
  for (const r of fresh) out.get(r.patient_id)!.newSinceSeal = r.n
  return out
}

/** How far the last sealed visit is behind the record: share links show the sealed copy only. */
export async function sealFreshness(tx: Tx, patientId: string): Promise<{ sealedLabel: string | null; newer: number }> {
  const prev = await latestSnapshot(tx, patientId)
  if (!prev) return { sealedLabel: null, newer: 0 }
  const sealed = prev.row.sealedAt
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(events)
    .where(and(eq(events.patientId, patientId), isNull(events.withdrawnAt), ne(events.eventType, 'patient_statement'), gt(events.receivedAt, sealed)))
  return { sealedLabel: prev.summary.sealedLabel.split(',')[0], newer: r?.n ?? 0 }
}

export type DoctorOverview = { firstLook: FirstLookRow[]; oncology: OncologyView }

const isDocType = (t: string | null): t is DocType => !!t && (DOC_TYPES as readonly string[]).includes(t)

export async function loadDoctorOverview(tx: Tx, patientId: string, s: StaffSession): Promise<DoctorOverview> {
  const at = (await now(s.orgId)).toISOString()
  const [rows, prev, completeness, heldRows] = await Promise.all([
    loadRecordRows(tx, patientId),
    latestSnapshot(tx, patientId),
    loadCompleteness(tx, patientId, s),
    tx.select({
      id: documents.id, docType: documents.docType, documentDate: documents.documentDate, identityResult: documents.identityResult,
      handwritten: documents.handwritten, lowConfidence: documents.lowConfidence, attachState: documents.attachState, status: documents.status, duplicateOf: documents.duplicateOf,
    }).from(documents).where(and(eq(documents.patientId, patientId), or(eq(documents.attachState, 'pending_decision'), eq(documents.status, 'needs_review')))),
  ])
  const input = { rows, role: s.role, now: at }
  const full = buildLedgerView({ ...input, prev: null })
  const diff = prev ? buildLedgerView({ ...input, prev: { snapshot: prev.snapshot, summary: prev.summary } }) : full

  const quoteOf = (i: { sources: { quote: string }[] }) => i.sources.find((x) => x.quote)?.quote ?? null
  const newItems = dropDateOnlyImaging(prev
    ? [...diff.events.new_since_last_visit, ...diff.events.newly_received_older, ...diff.events.amended]
    : full.events.initial_record)
  const held: HeldDoc[] = heldRows.filter((d) => !d.duplicateOf).map((d) => ({
    id: d.id, docLabel: isDocType(d.docType) ? staffDocLabel(d.docType) : 'Document', date: d.documentDate,
    kind: classifyHeld({ identityResult: d.identityResult, handwritten: d.handwritten, lowConfidence: d.lowConfidence }),
  }))
  const askAt = (it: (typeof completeness.open)[number]) => it.trigger?.institution ?? it.triggerDoc?.institution ?? null

  const firstLook = buildFirstLook({
    patientId,
    seal: prev ? { id: prev.summary.id, seq: prev.summary.seq, sealedLabel: prev.summary.sealedLabel, signerName: prev.summary.signerName } : null,
    newTotal: newItems.length,
    newItems: newItems.slice(0, 12).map((i) => ({ id: i.id, typeLabel: i.typeLabel, headline: i.headline, when: i.when.event, quote: quoteOf(i) })),
    amended: diff.events.amended.length,
    patientSaid: diff.patientSaid.length,
    conflicts: diff.conflicts.map((c) => ({ key: c.key, label: c.label })),
    missing: completeness.open.map((it) => ({ id: it.id, title: it.wording.en, askAt: askAt(it), state: it.state })),
    held,
    unverified: full.counts.unverified,
    disputed: full.counts.disputed,
  })

  return { firstLook, oncology: oncologyView(full.events.initial_record) }
}

