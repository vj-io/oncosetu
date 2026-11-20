// A study that came in several uploads (same StudyInstanceUID) is one study to look at. The parts stay stored as they arrived
// (originals are never changed); this finds them so the viewer can step through all of them as one series.
import { and, eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents } from '@/db/schema'
import { STUDY_BUNDLE_MIME } from './study'

export type StudyPart = { id: string; instances: number; receivedAt: Date }
const FILED = ['auto', 'attached'] // the same papers the records list shows

/** The parts of the study a bundle document belongs to, oldest first. The first one stands for the study (it is the one the list shows). */
export async function studyParts(tx: Tx, doc: { id: string; patientId: string; flags: unknown; attachState: string }): Promise<StudyPart[]> {
  const uid = (doc.flags as { imaging?: { studyUid?: string | null } } | null)?.imaging?.studyUid
  if (!uid || !FILED.includes(doc.attachState)) return [] // a held paper is looked at alone
  const rows = await tx.select({ id: documents.id, flags: documents.flags, receivedAt: documents.receivedAt, attachState: documents.attachState, status: documents.status, duplicateOf: documents.duplicateOf })
    .from(documents).where(and(eq(documents.patientId, doc.patientId), eq(documents.mime, STUDY_BUNDLE_MIME)))
  return rows
    .filter((r) => FILED.includes(r.attachState) && r.status !== 'quarantined' && !r.duplicateOf && (r.flags as { imaging?: { studyUid?: string | null } })?.imaging?.studyUid === uid)
    .map((r) => ({ id: r.id, instances: Number((r.flags as { imaging?: { instances?: number } }).imaging?.instances ?? 1), receivedAt: r.receivedAt }))
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || (a.id < b.id ? -1 : 1))
}
