// Read model for the clinician "First look" card and the oncology fact strip on the patient overview.
// Reads existing facts only (ledger, completeness checklist, held documents). Run inside withPatientAccess.
import { and, eq, or } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents } from '@/db/schema'
import { buildFirstLook, classifyHeld, type FirstLookRow, type HeldDoc } from '@/core/doctor/first-look'
import { oncologyView, type OncologyView } from '@/core/doctor/oncology'
import { DOC_TYPES, type DocType } from '@/core/types'
import { staffDocLabel } from '@/core/copy'
import { now } from '../clock'
import { buildLedgerView } from '../ledger/core'
import { latestSnapshot, loadRecordRows } from '../ledger/record'
import { loadCompleteness } from '../radar-ui/completeness'
import type { StaffSession } from '../session'

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
  const newItems = prev
    ? [...diff.events.new_since_last_visit, ...diff.events.newly_received_older, ...diff.events.amended]
    : full.events.initial_record
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

