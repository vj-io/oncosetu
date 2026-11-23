// Read model for the patient workspace landing page ("gallery wall").
import { hardToReadDoc, isHeldDoc } from '../pipeline/held'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { caregivers, documents, encounters, patients, snapshots } from '@/db/schema'
import { activeConsent, loadPatient, type ActiveConsent, type PatientView } from '../patients'
import { primaryContactTarget } from './contact'
import { accession } from './http'

export type OverviewStep = { key: string; label: string; done: boolean }
export type Overview = {
  patient: PatientView
  accession: string
  consent: ActiveConsent | null
  docTotal: number
  awaitingDecision: number
  needsReview: number
  steps: OverviewStep[]
  encounter: { id: string; type: string; startedAt: Date } | null
  snapshot: { seq: number; sha256: string; sealedAt: Date } | null
  /** FR-ID-07: ABHA captured (verified only through ABDM M1, not built). Whether the same person is a patient of another
   *  organisation is not shown: PRD §10.3 gives another organisation's data only through a patient consent link, and
   *  person_registered_elsewhere() (drizzle/0019) stays unused until that consent exists. */
  abha: { verified: boolean } | null
  /** How the primary contact signs in to the portal: with their password, with a code each time, or not at all (no phone). */
  portalSignIn: 'password' | 'code_only' | 'no_phone'
}

export async function loadOverview(tx: Tx, patientId: string): Promise<Overview | null> {
  const patient = await loadPatient(tx, patientId)
  if (!patient) return null
  const [consent, byType, [pending], [review], [enc], [snap], target, [abha]] = await Promise.all([
    activeConsent(tx, patientId),
    tx.select({ type: documents.docType, n: count() }).from(documents)
      .where(and(eq(documents.patientId, patientId), inArray(documents.attachState, ['auto', 'attached']))).groupBy(documents.docType),
    tx.select({ n: count() }).from(documents).where(and(eq(documents.patientId, patientId), isHeldDoc)),
    tx.select({ n: count() }).from(documents).where(and(eq(documents.patientId, patientId), hardToReadDoc)),
    tx.select().from(encounters).where(eq(encounters.patientId, patientId)).orderBy(desc(encounters.startedAt)).limit(1),
    tx.select().from(snapshots).where(eq(snapshots.patientId, patientId)).orderBy(desc(snapshots.seq)).limit(1),
    primaryContactTarget(tx, patientId),
    tx.select({ onFile: sql<boolean>`${patients.abhaHmac} is not null`, verified: patients.abhaVerified, pw: sql<boolean>`${patients.passwordHash} is not null` })
      .from(patients).where(eq(patients.id, patientId)),
  ])
  const docTotal = byType.reduce((n, d) => n + d.n, 0)
  // Whoever signs in by phone (the primary contact) has chosen a portal password, or still needs a code each time.
  const [cgPw] = target?.caregiverId ? await tx.select({ pw: sql<boolean>`${caregivers.passwordHash} is not null` }).from(caregivers).where(eq(caregivers.id, target.caregiverId)) : []
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
    patient, accession: accession(patientId), consent, docTotal, awaitingDecision: pending.n, needsReview: review.n,
    steps, encounter: enc ? { id: enc.id, type: enc.type, startedAt: enc.startedAt } : null,
    snapshot: snap ? { seq: snap.seq, sha256: snap.sha256, sealedAt: snap.sealedAt } : null,
    abha: abha?.onFile ? { verified: abha.verified } : null,
    portalSignIn: !target ? 'no_phone' : (target.caregiverId ? cgPw?.pw : abha?.pw) ? 'password' : 'code_only',
  }
}
