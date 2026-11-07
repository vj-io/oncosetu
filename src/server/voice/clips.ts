// Voice answers kept beside their transcript (FR-VOX-05). Encrypted with a key per clip, like every stored file;
// linked to the statement it became when the person confirms; read back by staff only (audited by the route).
import { and, eq, inArray, isNull } from 'drizzle-orm'
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
