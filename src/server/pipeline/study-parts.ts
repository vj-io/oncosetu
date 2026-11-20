// A study that came in several uploads (same StudyInstanceUID) is one study to look at. The parts stay stored as they arrived
// (originals are never changed); this finds them so the viewer can step through all of them as one series.
import { and, eq, inArray } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents } from '@/db/schema'
import { STUDY_BUNDLE_MIME } from './study'

/** `slices` = the pictures the viewer steps through in this part: its instances, or a single file's frames (as collapseStudyParts counts). */
export type StudyPart = { id: string; mime: string; slices: number; receivedAt: Date }
const FILED = ['auto', 'attached'] // the same papers the records list shows

type Imaging = { imaging?: { studyUid?: string | null; instances?: number; frames?: number } } | null

/** The parts of the study a scan document belongs to (bundles and single files), oldest first. The first one stands for the study. */
export async function studyParts(tx: Tx, doc: { id: string; patientId: string; flags: unknown; attachState: string }): Promise<StudyPart[]> {
  const uid = (doc.flags as Imaging)?.imaging?.studyUid
  if (!uid || !FILED.includes(doc.attachState)) return [] // a held paper is looked at alone
  const rows = await tx.select({ id: documents.id, mime: documents.mime, flags: documents.flags, receivedAt: documents.receivedAt, attachState: documents.attachState, status: documents.status, duplicateOf: documents.duplicateOf })
    .from(documents).where(and(eq(documents.patientId, doc.patientId), inArray(documents.mime, [STUDY_BUNDLE_MIME, 'application/dicom'])))
  return rows
    .filter((r) => FILED.includes(r.attachState) && r.status !== 'quarantined' && !r.duplicateOf && (r.flags as Imaging)?.imaging?.studyUid === uid)
    .map((r) => {
      const im = (r.flags as Imaging)?.imaging
      const instances = Number(im?.instances ?? 1)
      return { id: r.id, mime: r.mime, slices: Math.max(1, instances > 1 ? instances : Number(im?.frames ?? 1)), receivedAt: r.receivedAt }
    })
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || (a.id < b.id ? -1 : 1))
}

/** Which part holds picture `index` of the study stepped through as one series (parts oldest first), and the position inside it. */
export function locateSlice<P extends { slices: number }>(parts: readonly P[], index: number): P & { index: number } {
  let i = Math.max(0, index)
  for (const [k, p] of parts.entries()) {
    if (i < p.slices || k === parts.length - 1) return { ...p, index: Math.min(i, p.slices - 1) }
    i -= p.slices
  }
  throw new Error('a study has at least one part')
}

/**
 * What the preview draws for document `doc`: when it stands for a study sent in several parts, picture `frame` of the whole series
 * (the middle one by default), found in its part; otherwise frame `frame` of the document itself.
 */
export function previewTarget(doc: { id: string; mime: string }, parts: readonly StudyPart[], frame?: number): { id: string; mime: string; index?: number } {
  if (parts.length < 2 || parts[0].id !== doc.id) return { id: doc.id, mime: doc.mime, index: frame }
  return locateSlice(parts, frame ?? Math.floor(parts.reduce((n, p) => n + p.slices, 0) / 2))
}
