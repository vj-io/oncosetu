// The share payload (FR-PAS-01, §6.6): the latest SEALED snapshot as a document index — never a clinical summary.
// Pure. Unless disclosure is cleared: neutral document labels, neutral absent-document wording, no quotes, brand
// "Setu Records", and free text that names a diagnosis (an institution) is dropped (FR-CON-07).
import { brandFor, patientDocLabel } from '@/core/copy'
import type { Snapshot } from '@/core/ledger'
import type { DatePrecision, Disclosure, DocType, EventType, Lang, MissingState } from '@/core/types'
import { ts } from '@/i18n/shares'
import type { L2 } from '../radar-ui/wording'
import { guardFree } from '../requests/letter'

export type ShareScope = 'index' | 'index_with_quotes'
export type Verification = 'records' | 'clinician' | 'verified' | 'unverified' | 'disputed'

export type SharePayload = {
  v: 1
  kind: 'document_index'
  brand: 'OncoSetu' | 'Setu Records'
  scope: ShareScope
  heading: L2
  notice: L2
  /** Sealed-at timestamp (ISO). */
  asOf: string
  items: {
    label: L2; date: string | null; precision: DatePrecision; institution: string | null
    source: { documentId: string | null; label: L2 | null; page: number | null }
    verification: Verification
    quote?: string
  }[]
  documents: { id: string; label: L2; date: string | null; institution: string | null; receivedAt: string }[]
  absent: { text: L2; state: MissingState }[]
  seal: { snapshotId: string; sha256: string; verifyPath: string }
}

export type PayloadInput = {
  snapshot: Snapshot
  snapshotId: string
  sha256: string
  disclosure: Disclosure
  scope: ShareScope
  /** eventId → who made the latest verification at or before the seal. */
  verifiers: Record<string, 'records' | 'clinician'>
  /** eventId → first evidence quote; read only when cleared and scope is index_with_quotes. */
  quotes: Record<string, string>
  /** dedupeKey → neutral wording of the absent document (used unless cleared). */
  absentNeutral: Record<string, L2>
}

export class QuotesNotAllowed extends Error {}

/** What kind of document an item stands for; items without a natural type use their source document's type. */
const EVENT_DOC: Partial<Record<EventType, DocType>> = {
  procedure_documented: 'procedure_note',
  pathology_report_documented: 'pathology_report',
  molecular_test_documented: 'ihc_molecular_report',
  imaging_report_documented: 'imaging_report',
  lab_report_documented: 'lab_report',
  lab_results_documented: 'lab_report',
  prescription_documented: 'prescription_printed',
  chemotherapy_session_documented: 'chemo_daycare_record',
  radiotherapy_documented: 'radiotherapy_summary',
  discharge_documented: 'discharge_summary',
  consultation_documented: 'consult_note',
}

const both = (f: (l: Lang) => string): L2 => ({ en: f('en'), hi: f('hi') })

export function buildSharePayload(i: PayloadInput): SharePayload {
  const cleared = i.disclosure === 'cleared'
  if (i.scope === 'index_with_quotes' && !cleared) throw new QuotesNotAllowed('Quotes are shared only when disclosure is cleared')
  const brand = brandFor(i.disclosure)
  const label = (t: DocType) => both((l) => patientDocLabel(t, i.disclosure, l))
  const docs = new Map(i.snapshot.documents.map((d) => [d.id, d]))

  const items = [...i.snapshot.verified, ...i.snapshot.unverified]
    .filter((e) => e.eventType !== 'patient_statement')
    .map((e) => ({ e, k: `${e.eventDate ?? e.documentDate ?? '9999'}|${e.id}` }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map(({ e }) => e)
    .map((e) => {
      const ev = e.evidence[0]
      const srcId = ev?.documentId ?? e.documentId
      const src = srcId ? docs.get(srcId) : undefined
      const type = EVENT_DOC[e.eventType] ?? src?.docType ?? 'other'
      const inst = typeof e.fields.institution_name === 'string' ? e.fields.institution_name : src?.institution ?? null
      const verification: Verification = e.label === 'Disputed' ? 'disputed' : e.label === 'Verified' ? i.verifiers[e.id] ?? 'verified' : 'unverified'
      const quote = cleared && i.scope === 'index_with_quotes' ? i.quotes[e.id] : undefined
      return {
        label: label(type),
        date: e.eventDate ?? e.documentDate,
        precision: e.eventDate ? e.datePrecision : e.documentDate ? 'day' as const : 'unknown' as const,
        institution: guardFree(inst, i.disclosure),
        source: { documentId: srcId ?? null, label: src ? label(src.docType) : null, page: ev?.pageNo ?? null },
        verification,
        ...(quote ? { quote } : {}),
      }
    })

  return {
    v: 1,
    kind: 'document_index',
    brand,
    scope: i.scope,
    heading: both((l) => ts(l, 'heading')),
    notice: both((l) => ts(l, 'notice', { brand })),
    asOf: i.snapshot.sealedAt,
    items,
    documents: i.snapshot.documents.map((d) => ({
      id: d.id, label: label(d.docType), date: d.documentDate, institution: guardFree(d.institution, i.disclosure), receivedAt: d.receivedAt,
    })).sort((a, b) => (a.date ?? a.receivedAt).localeCompare(b.date ?? b.receivedAt)),
    absent: i.snapshot.missing.map((m) => ({
      state: m.state,
      text: cleared && m.wording?.en
        ? m.wording
        : i.absentNeutral[m.dedupeKey] ?? both((l) => ts(l, 'absentFallback', { label: patientDocLabel(m.expectedTypes[0] ?? 'other', i.disclosure, l) })),
    })),
    seal: { snapshotId: i.snapshotId, sha256: i.sha256, verifyPath: `/verify/${i.snapshotId}` },
  }
}
