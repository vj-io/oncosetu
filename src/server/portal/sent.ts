// "Papers you sent": every file this person (the patient, or one caregiver) uploaded, with what became of it. A paper held
// for an identity check, or not filed, used to vanish from the portal; the person who sent it always sees it, and may open
// it again (their own file: patientMayOpen), except a quarantined file and a scan study (shown by the clinic's viewer only).
// File names are shown here, never in the clinic's list (summary.ts): a name such as "…_PET_report.pdf" can name a diagnosis,
// so each person sees only the names of files they sent themselves (a patient never sees a caregiver's, and the reverse).
import { and, desc, eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents } from '@/db/schema'
import { formatDateIN, istDate } from '@/core/copy'
import type { Lang } from '@/core/types'
import { tp, type PatientKey } from '@/i18n/patient'
import { decryptField } from '../crypto'
import { portalActor } from '../pipeline/actions'
import { STUDY_BUNDLE_MIME } from '../pipeline/study'
import type { PatientSession } from '../session'

export type SentState = 'checking' | 'filed' | 'not_filed' | 'blocked'
export type SentRow = { id: string; name: string | null; sentAt: string; state: SentState; open: boolean }

/** What became of one upload, in the person's terms. */
export function sentState(d: { attachState: string; status: string }): SentState {
  if (d.status === 'quarantined') return 'blocked'
  if (d.attachState === 'rejected' || d.attachState === 'detached') return 'not_filed'
  if (d.attachState === 'pending_decision' || d.status === 'queued' || d.status === 'processing') return 'checking'
  return 'filed'
}

/** The 50 latest uploads by this person, newest first. Duplicates of a paper already sent are left out. */
export async function loadSentPapers(tx: Tx, s: PatientSession): Promise<SentRow[]> {
  const who = portalActor(s)
  const rows = await tx.select({
    id: documents.id, filenameEnc: documents.filenameEnc, receivedAt: documents.receivedAt, attachState: documents.attachState,
    status: documents.status, mime: documents.mime, duplicateOf: documents.duplicateOf,
  }).from(documents).where(and(eq(documents.patientId, s.patientId), eq(documents.uploadedByKind, who.kind), eq(documents.uploadedById, who.id)))
    .orderBy(desc(documents.receivedAt)).limit(50)
  return rows.filter((r) => !r.duplicateOf).map((r) => {
    const state = sentState(r)
    let name: string | null = null
    try { name = r.filenameEnc ? decryptField(r.filenameEnc) : null } catch { name = null }
    return { id: r.id, name, sentAt: r.receivedAt.toISOString(), state, open: state !== 'blocked' && r.mime !== 'application/dicom' && r.mime !== STUDY_BUNDLE_MIME }
  })
}

const STATE_KEY: Record<SentState, PatientKey> = { checking: 'sentChecking', filed: 'sentFiled', not_filed: 'sentNotFiled', blocked: 'sentBlocked' }

/** The rows as the page shows them. */
export function buildSent(rows: SentRow[], lang: Lang) {
  return rows.map((r) => ({
    id: r.id, name: r.name ?? tp(lang, 'sentUnnamed'), sent: tp(lang, 'sentOn', { date: formatDateIN(istDate(r.sentAt), lang) }),
    state: r.state, status: tp(lang, STATE_KEY[r.state]), open: r.open,
  }))
}
