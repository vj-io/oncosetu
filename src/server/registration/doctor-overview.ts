// Read model for the clinician "First look" card and the oncology fact strip on the patient overview.
// Reads existing facts only (ledger, completeness checklist, held documents). Run inside withPatientAccess.
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents, missingRecords, snapshots } from '@/db/schema'
import { buildFirstLook, classifyHeld, type FirstLookRow, type HeldDoc } from '@/core/doctor/first-look'
import { newestItemsFirst, newItemTotal } from '@/core/doctor/new-since-seal'
import { dropDateOnlyImaging, oncologyView, type OncologyView } from '@/core/doctor/oncology'
import { DOC_TYPES, type DocType } from '@/core/types'
import { staffDocLabel } from '@/core/copy'
import { placeFromWording, sameWords } from '@/components/doctor/facts'
import { now } from '../clock'
import { buildLedgerView } from '../ledger/core'
import { latestSnapshot, loadRecordRows } from '../ledger/record'
import { hardToReadDoc, isHeldDoc } from '../pipeline/held'
import { loadCompleteness } from '../radar-ui/completeness'
import type { StaffSession } from '../session'

export type PatientGlance = { documents: number; notInFile: number; newSinceSeal: number; lastSealed: Date | null }

/** The four numbers a clinician scans on the patient list. One grouped query each, not one per patient. */
export async function patientGlances(tx: Tx, ids: string[], orgId: string): Promise<Map<string, PatientGlance>> {
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
  const fresh = await newSinceSealCounts(tx, ids, orgId)
  for (const [id, n] of fresh) out.get(id)!.newSinceSeal = n
  return out
}

/**
 * The "new" count per patient: the same number the What's new page lists (DOC-01), so the tab badge, the patients list and
 * First look all agree. Built from the ledger view, not from raw event ids (which also count duplicates and held items).
 */
export async function newSinceSealCounts(tx: Tx, ids: string[], orgId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>(ids.map((id) => [id, 0]))
  if (!ids.length) return out
  const at = (await now(orgId)).toISOString()
  await Promise.all(ids.map(async (id) => {
    const [rows, prev] = await Promise.all([loadRecordRows(tx, id), latestSnapshot(tx, id)])
    out.set(id, newItemTotal(buildLedgerView({ rows, prev: prev ? { snapshot: prev.snapshot, summary: prev.summary } : null, role: 'clinician', now: at })))
  }))
  return out
}

/** How far the last sealed visit is behind the record: share links show the sealed copy only. */
export async function sealFreshness(tx: Tx, patientId: string, orgId: string): Promise<{ sealedLabel: string | null; newer: number }> {
  const prev = await latestSnapshot(tx, patientId)
  if (!prev) return { sealedLabel: null, newer: 0 }
  return { sealedLabel: prev.summary.sealedLabel.split(',')[0], newer: (await newSinceSealCounts(tx, [patientId], orgId)).get(patientId) ?? 0 }
}

export type DoctorOverview = { firstLook: FirstLookRow[]; oncology: OncologyView }

/** A held scan is named for what it is ("X-ray"), never "Other document". */
function heldLabel(d: { docType: string | null; flags: Record<string, unknown> }): string {
  const im = d.flags.imaging as { studyLabel?: string; modalityLabel?: string } | undefined
  if (im) return String(im.studyLabel ?? im.modalityLabel ?? 'Scan')
  return isDocType(d.docType) ? staffDocLabel(d.docType) : 'Document'
}

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
      flags: documents.flags,
    }).from(documents).where(and(eq(documents.patientId, patientId), or(isHeldDoc, hardToReadDoc))),
  ])
  const input = { rows, role: s.role, now: at }
  const full = buildLedgerView({ ...input, prev: null })
  const diff = prev ? buildLedgerView({ ...input, prev: { snapshot: prev.snapshot, summary: prev.summary } }) : full

  const quoteOf = (i: { sources: { quote: string }[] }) => i.sources.find((x) => x.quote)?.quote ?? null
  // One quote per line: when the headline already holds those words the quote is not printed again.
  const quoteFor = (i: { headline: string | null; sources: { quote: string }[] }) => { const q = quoteOf(i); return q && sameWords(i.headline, q) ? null : q }
  const allNew = prev ? [...diff.events.new_since_last_visit, ...diff.events.newly_received_older, ...diff.events.amended] : full.events.initial_record
  // Newest first, like the rest of the page (DOC-06); the oldest paper never leads the preview. Undated last.
  const newItems = newestItemsFirst(dropDateOnlyImaging(allNew))
  // "Held" is the same set the Documents page and the records To do count (REC-04); hard-to-read filed papers are a separate number.
  const heldOnly = heldRows.filter((d) => d.attachState === 'pending_decision')
  const hardToRead = heldRows.length - heldOnly.length
  const held: HeldDoc[] = heldOnly.map((d) => ({
    id: d.id, docLabel: heldLabel(d), date: d.documentDate,
    kind: classifyHeld({ identityResult: d.identityResult, handwritten: d.handwritten, lowConfidence: d.lowConfidence }),
  }))
  // The place a paper was mentioned from: the document that mentions it, else the place in the patient's own words.
  const askAt = (it: (typeof completeness.open)[number]) => it.trigger?.institution ?? it.triggerDoc?.institution ?? placeFromWording(it.wording.en)

  const firstLook = buildFirstLook({
    patientId,
    seal: prev ? { id: prev.summary.id, seq: prev.summary.seq, sealedLabel: prev.summary.sealedLabel, signerName: prev.summary.signerName } : null,
    newTotal: newItemTotal(diff),
    newItems: newItems.slice(0, 12).map((i) => ({ id: i.id, typeLabel: i.typeLabel, headline: i.headline, when: i.when.event, quote: quoteFor(i) })),
    amended: diff.events.amended.length,
    patientSaid: diff.patientSaid.length,
    conflicts: diff.conflicts.map((c) => ({ key: c.key, label: c.label })),
    missing: completeness.open.map((it) => ({ id: it.id, title: it.wording.en, askAt: askAt(it), state: it.state })),
    held,
    hardToRead,
    unverified: full.counts.unverified,
    disputed: full.counts.disputed,
  })

  return { firstLook, oncology: oncologyView(full.events.initial_record) }
}

