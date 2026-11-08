// Voice answers kept beside their transcript (FR-VOX-05). Encrypted with a key per clip, like every stored file;
// linked to the statement it became when the person confirms; read back by staff only (audited by the route).
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { Tx } from '@/db'
import { voiceClips } from '@/db/schema'
import { decryptBytes, encryptBytes } from '../crypto'
import { asr } from './provider'

export type Uploader = { kind: 'patient' | 'caregiver' | 'staff'; id: string }

export async function storeClip(tx: Tx, c: { orgId: string; patientId: string; by: Uploader; bytes: Uint8Array; mime: string; seconds: number }): Promise<string> {
  const { bytes, dekWrapped } = encryptBytes(Buffer.from(c.bytes))
  const [row] = await tx.insert(voiceClips).values({
    orgId: c.orgId, patientId: c.patientId, mime: c.mime.split(';')[0] || 'audio/webm', size: c.bytes.length, seconds: c.seconds,
    bytesEnc: bytes, dekWrapped, asrProvider: asr.name, asrModel: asr.model, createdByKind: c.by.kind, createdById: c.by.id,
  }).returning({ id: voiceClips.id })
  return row.id
}

/**
 * A desk audio note of an encounter (offline capture, 0020): kept encrypted, not transcribed. The id is the capture device's
 * UUIDv7, so a re-sent note (lost response, reload mid-sync) is stored once. Returns false when that id is another patient's.
 */
export async function storeDeskNote(tx: Tx, c: { id: string; orgId: string; patientId: string; encounterId: string; by: Uploader; bytes: Uint8Array; mime: string; seconds: number }): Promise<{ created: boolean } | null> {
  const { bytes, dekWrapped } = encryptBytes(Buffer.from(c.bytes))
  const [row] = await tx.insert(voiceClips).values({
    id: c.id, orgId: c.orgId, patientId: c.patientId, encounterId: c.encounterId, mime: c.mime.split(';')[0] || 'audio/webm', size: c.bytes.length,
    seconds: c.seconds, bytesEnc: bytes, dekWrapped, asrProvider: 'none', asrModel: 'none', createdByKind: c.by.kind, createdById: c.by.id,
  }).onConflictDoNothing({ target: voiceClips.id }).returning({ id: voiceClips.id })
  if (row) return { created: true }
  const [prev] = await tx.select({ id: voiceClips.id }).from(voiceClips).where(and(eq(voiceClips.id, c.id), eq(voiceClips.patientId, c.patientId)))
  return prev ? { created: false } : null
}

/** Desk audio notes of this patient, newest first (no bytes). */
export const listDeskNotes = (tx: Tx, patientId: string) =>
  tx.select({ id: voiceClips.id, encounterId: voiceClips.encounterId, seconds: voiceClips.seconds, createdAt: voiceClips.createdAt }).from(voiceClips)
    .where(and(eq(voiceClips.patientId, patientId), isNotNull(voiceClips.encounterId))).orderBy(desc(voiceClips.createdAt))

/** Links this patient's not-yet-linked clips to the statement they became. Clips of anyone else are ignored. */
export async function linkClips(tx: Tx, patientId: string, clipIds: readonly string[], statementId: string): Promise<string[]> {
  if (!clipIds.length) return []
  const rows = await tx.update(voiceClips).set({ statementId })
    .where(and(eq(voiceClips.patientId, patientId), inArray(voiceClips.id, [...clipIds]), isNull(voiceClips.statementId)))
    .returning({ id: voiceClips.id })
  return rows.map((r) => r.id)
}

export async function readClip(tx: Tx, patientId: string, clipId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const [c] = await tx.select().from(voiceClips).where(and(eq(voiceClips.id, clipId), eq(voiceClips.patientId, patientId)))
  return c ? { bytes: new Uint8Array(decryptBytes(Buffer.from(c.bytesEnc), c.dekWrapped)), mime: c.mime } : null
}
