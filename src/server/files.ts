// Encrypted file storage in Postgres bytea (ADR-001a). No public URLs: files are streamed by route handlers.
import { eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documentFiles } from '@/db/schema'
import { decryptBytes, encryptBytes, sha256Hex } from './crypto'

export type StoreFileInput = {
  orgId: string; patientId: string; documentId: string; kind: 'original' | 'page_image'
  pageNo?: number | null; mime: string; bytes: Buffer
  /** What made a derived file (page images, FR-DOC-08); null for originals. */
  processor?: { name: string; version: string } | null
}

/** Must run inside withOrg(orgId). */
export async function storeFile(tx: Tx, f: StoreFileInput): Promise<{ id: string; size: number; sha256: string }> {
  const { bytes, dekWrapped } = encryptBytes(f.bytes)
  const sha256 = sha256Hex(f.bytes)
  const [row] = await tx.insert(documentFiles).values({
    orgId: f.orgId, patientId: f.patientId, documentId: f.documentId, kind: f.kind, pageNo: f.pageNo ?? null,
    mime: f.mime, bytesEnc: bytes, dekWrapped, size: f.bytes.length, sha256,
    processor: f.processor?.name ?? null, processorVersion: f.processor?.version ?? null,
  }).returning({ id: documentFiles.id })
  return { id: row.id, size: f.bytes.length, sha256 }
}

/** Decrypts a file visible under the current RLS org; null if absent. */
export async function readFile(tx: Tx, fileId: string) {
  const [f] = await tx.select().from(documentFiles).where(eq(documentFiles.id, fileId))
  if (!f) return null
  return {
    id: f.id, documentId: f.documentId, patientId: f.patientId, kind: f.kind, pageNo: f.pageNo, mime: f.mime,
    sha256: f.sha256, bytes: decryptBytes(Buffer.from(f.bytesEnc), f.dekWrapped),
  }
}
