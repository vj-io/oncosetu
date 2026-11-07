// Read model for the patient workspace landing page ("gallery wall").
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents, encounters, events, missingRecords, snapshots } from '@/db/schema'
import { formatDateIN, staffDocLabel } from '@/core/copy'
import { DOC_TYPES, type DocType } from '@/core/types'
import { activeConsent, loadPatient, type ActiveConsent, type PatientView } from '../patients'
import { primaryContactTarget } from './contact'
import { accession } from './http'

export type OverviewStep = { key: string; label: string; done: boolean }
export type Overview = {
  patient: PatientView
  accession: string
  consent: ActiveConsent | null
  docs: { type: string; label: string; count: number }[]
  docTotal: number
  awaitingDecision: number
  needsReview: number
  missing: { id: string; label: string; detail: string | null; state: 'expected' | 'requested' | 'received' }[]
  steps: OverviewStep[]
  encounter: { id: string; type: string; startedAt: Date } | null
  snapshot: { seq: number; sha256: string; sealedAt: Date } | null
}

const isDocType = (t: string | null): t is DocType => !!t && (DOC_TYPES as readonly string[]).includes(t)
const EVENT_WORDS: Record<string, string> = {
  report_pending_documented: 'report listed as still awaited', procedure_documented: 'procedure', pathology_report_documented: 'pathology report',
  molecular_test_documented: 'molecular test', imaging_report_documented: 'imaging report', lab_report_documented: 'lab report',
  chemotherapy_session_documented: 'chemotherapy visit', radiotherapy_documented: 'radiotherapy', discharge_documented: 'hospital discharge',
  admission_documented: 'hospital admission', prescription_documented: 'prescription', consultation_documented: 'consultation', referral_documented: 'referral',
}
const eventWords = (t: string) => EVENT_WORDS[t] ?? t.replace(/_documented$/, '').replace(/_/g, ' ')

export async function loadOverview(tx: Tx, patientId: string): Promise<Overview | null> {
  const patient = await loadPatient(tx, patientId)
  if (!patient) return null
  const [consent, byType, [pending], [review], missingRows, [enc], [snap], target] = await Promise.all([
    activeConsent(tx, patientId),
    tx.select({ type: documents.docType, n: count() }).from(documents)
      .where(and(eq(documents.patientId, patientId), inArray(documents.attachState, ['auto', 'attached']))).groupBy(documents.docType),
    tx.select({ n: count() }).from(documents).where(and(eq(documents.patientId, patientId), eq(documents.attachState, 'pending_decision'))),
    tx.select({ n: count() }).from(documents).where(and(eq(documents.patientId, patientId), eq(documents.status, 'needs_review'))),
    tx.select({ m: missingRecords, evType: events.eventType, evDate: events.eventDate }).from(missingRecords)
      .leftJoin(events, eq(events.id, missingRecords.triggerEventId))
      .where(and(eq(missingRecords.patientId, patientId), eq(missingRecords.mode, 'production'), inArray(missingRecords.state, ['expected', 'requested', 'received'])))
      .orderBy(desc(missingRecords.createdAt)),
    tx.select().from(encounters).where(eq(encounters.patientId, patientId)).orderBy(desc(encounters.startedAt)).limit(1),
    tx.select().from(snapshots).where(eq(snapshots.patientId, patientId)).orderBy(desc(snapshots.seq)).limit(1),
    primaryContactTarget(tx, patientId),
  ])
  const docs = byType.map((r) => ({ type: r.type ?? 'unclassified', label: isDocType(r.type) ? staffDocLabel(r.type) : 'Not yet classified', count: r.n }))
    .sort((a, b) => b.count - a.count)
  const docTotal = docs.reduce((n, d) => n + d.count, 0)
  const steps: OverviewStep[] = [
    { key: 'identity', label: 'Identity registered', done: true },
    { key: 'consent', label: 'Consent on file', done: !!consent?.purposes.store },
    { key: 'disclosure', label: 'Whether the patient knows the diagnosis has been recorded by a clinician', done: patient.disclosure !== 'unknown' },
    { key: 'contact', label: 'Primary contact reachable', done: !!target },
    { key: 'records', label: 'Records received', done: docTotal + pending.n > 0 },
    { key: 'reviewed', label: 'Received records reviewed', done: docTotal + pending.n > 0 && pending.n === 0 && review.n === 0 },
    { key: 'snapshot', label: 'First visit sealed', done: !!snap },
  ]
  return {
    patient, accession: accession(patientId), consent, docs, docTotal, awaitingDecision: pending.n, needsReview: review.n,
    missing: missingRows.map(({ m, evType, evDate }) => ({
      id: m.id, state: m.state as 'expected' | 'requested' | 'received',
      label: m.expectedTypes.map((t) => (isDocType(t) ? staffDocLabel(t) : t)).join(' or '),
      detail: evType ? `Mentioned alongside the ${eventWords(evType)} dated ${formatDateIN(evDate)}` : null,
    })),
    steps, encounter: enc ? { id: enc.id, type: enc.type, startedAt: enc.startedAt } : null,
    snapshot: snap ? { seq: snap.seq, sha256: snap.sha256, sealedAt: snap.sealedAt } : null,
  }
}
