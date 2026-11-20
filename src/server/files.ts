// Encrypted file storage (ADR-001a): Postgres bytea, or for originals an S3-compatible object store when one is configured
// (objects.ts; the row then keeps only the key, size, hash and wrapped file key). No public URLs: route handlers stream files.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documentFiles } from '@/db/schema'
import { decryptBytes, encryptBytes, sha256Hex } from './crypto'
import { objectStore } from './objects'

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
  // originals (the big files) go to the object store when there is one; page images stay here (small, and versioned)
  const store = f.kind === 'original' ? objectStore() : null
  const objectKey = store ? `o/${f.orgId}/${randomUUID()}` : null
  if (store) await store.put(objectKey!, bytes)
  const [row] = await tx.insert(documentFiles).values({
    orgId: f.orgId, patientId: f.patientId, documentId: f.documentId, kind: f.kind, pageNo: f.pageNo ?? null,
    mime: f.mime, bytesEnc: store ? Buffer.alloc(0) : bytes, objectKey, dekWrapped, size: f.bytes.length, sha256,
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
    sha256: f.sha256, bytes: await storedBytes(f),
  }
}

/** The plaintext of a document_files row, wherever its ciphertext lives (AES-GCM: a changed object fails to decrypt). */
export async function storedBytes(f: { objectKey: string | null; bytesEnc: Buffer | Uint8Array; dekWrapped: string }): Promise<Buffer> {
  if (!f.objectKey) return decryptBytes(Buffer.from(f.bytesEnc), f.dekWrapped)
  const store = objectStore()
  if (!store) throw new Error('this file is in object storage, but no object store is configured (R2_*)')
  return decryptBytes(Buffer.from(await store.get(f.objectKey)), f.dekWrapped)
}
