// Encrypted file storage (ADR-001a): an S3-compatible object store when one is configured (objects.ts; the row then keeps
// only the key, size, hash and wrapped file key), else Postgres bytea. Every stored file body goes through sealFile:
// originals, page images, voice clips and held inbound files (until 0030 only originals did, and a free 1 GB database
// filled at about 3,500 pages; scripts/move-files-to-objects.ts moves the old ones). No public URLs: route handlers stream files.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documentFiles } from '@/db/schema'
import { decryptBytes, encryptBytes, sha256Hex } from './crypto'
import { HttpError } from './http'
import { log } from './log'
import { objectStore, ObjectStoreError, type ObjectStore } from './objects'

export type StoreFileInput = {
  orgId: string; patientId: string; documentId: string; kind: 'original' | 'page_image'
  pageNo?: number | null; mime: string; bytes: Buffer
  /** What made a derived file (page images, FR-DOC-08); null for originals. */
  processor?: { name: string; version: string } | null
}

/**
 * Encrypts a file with its own key. With an object store the ciphertext is uploaded (key o/<org>/<uuid>) and the row keeps
 * an empty bytes_enc; without one the ciphertext is the row's bytes_enc. Read it back with storedBytes.
 */
export async function sealFile(orgId: string, plain: Buffer): Promise<{ bytesEnc: Buffer; objectKey: string | null; dekWrapped: string }> {
  const { bytes, dekWrapped } = encryptBytes(plain)
  const store = objectStore()
  if (!store) return { bytesEnc: bytes, objectKey: null, dekWrapped }
  const objectKey = `o/${orgId}/${randomUUID()}`
  await store.put(objectKey, bytes)
  remember(objectKey, bytes) // processing reads an original back next
  return { bytesEnc: Buffer.alloc(0), objectKey, dekWrapped }
}

/** Must run inside withOrg(orgId). */
export async function storeFile(tx: Tx, f: StoreFileInput): Promise<{ id: string; size: number; sha256: string }> {
  const sealed = await sealFile(f.orgId, f.bytes)
  const sha256 = sha256Hex(f.bytes)
  const [row] = await tx.insert(documentFiles).values({
    orgId: f.orgId, patientId: f.patientId, documentId: f.documentId, kind: f.kind, pageNo: f.pageNo ?? null,
    mime: f.mime, ...sealed, size: f.bytes.length, sha256,
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

// ponytail: an in-memory cache of stored originals, per server instance. A scan is read slice by slice, and again on every
// scroll back or "play", and each read was a download from object storage, whose free tier caps downloads per day
// (Backblaze B2). Only ciphertext is kept: it is useless without the file's own key, which lives in its database row and
// goes with an erasure. Each original has its own key and is never rewritten, so an entry cannot go stale. Fluid Compute
// reuses an instance across requests; if many instances keep missing, move this to a shared cache (Vercel Runtime Cache).
// Ceiling: 256 MB holds a typical MRI study (about 1,400 slices of 128 KB); a study played end to end that is larger than
// the cache gets no hits on the next pass (least-recently-used order), so raise the limit or share the cache for big CT.
const limits = { total: 256 * 1024 * 1024, entry: 128 * 1024 * 1024 }
const cache = new Map<string, Uint8Array>() // in use order: the first entry is the least recently used
let cachedBytes = 0
const pending = new Map<string, Promise<Uint8Array>>()

function remember(key: string, sealed: Uint8Array) {
  if (sealed.byteLength > limits.entry || cache.has(key)) return
  cache.set(key, sealed)
  cachedBytes += sealed.byteLength
  for (const [k, v] of cache) {
    if (cachedBytes <= limits.total) break
    cache.delete(k)
    cachedBytes -= v.byteLength
  }
}

/**
 * The ciphertext of a stored original: from this instance's cache, else one download shared by concurrent readers.
 * A download is kept only once it has decrypted (storedBytes calls remember), so a changed object is never cached.
 */
function sealedOriginal(store: ObjectStore, key: string): Promise<Uint8Array> {
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit) // now the most recently used
    return Promise.resolve(hit)
  }
  const inFlight = pending.get(key)
  if (inFlight) return inFlight
  const p = store.get(key).finally(() => pending.delete(key))
  pending.set(key, p)
  return p
}

/** Tests only: empty the cache and set its limits. */
export function resetOriginalCacheForTests(next: Partial<typeof limits> = {}) {
  cache.clear()
  pending.clear()
  cachedBytes = 0
  limits.total = next.total ?? 256 * 1024 * 1024
  limits.entry = next.entry ?? 128 * 1024 * 1024
}

/** Shown when object storage cannot hand back a stored original. */
export const FILE_UNAVAILABLE = 'The stored file could not be read just now. It is kept: try again later, or ask an administrator to check the file storage (its daily download limit, or its access key).'

/** The plaintext of a document_files row, wherever its ciphertext lives (AES-GCM: a changed object fails to decrypt). */
export async function storedBytes(f: { objectKey: string | null; bytesEnc: Buffer | Uint8Array; dekWrapped: string }): Promise<Buffer> {
  if (!f.objectKey) return decryptBytes(Buffer.from(f.bytesEnc), f.dekWrapped)
  const store = objectStore()
  if (!store) throw new Error('this file is in object storage, but no object store is configured (S3_*)')
  let sealed: Uint8Array
  try {
    sealed = await sealedOriginal(store, f.objectKey)
  } catch (e) {
    // The store refused or could not be reached (a key without read access, another bucket, an outage). The original is
    // kept; say so plainly instead of failing with an unhandled error that the viewer shows as a compression problem.
    log.error('stored file could not be read', e instanceof ObjectStoreError ? { status: e.status, storageCode: e.storageCode } : { errorName: (e as Error).name })
    throw new HttpError(503, 'file_unavailable', FILE_UNAVAILABLE)
  }
  const plain = decryptBytes(Buffer.from(sealed), f.dekWrapped) // AES-GCM: throws on a changed object, before it is kept
  remember(f.objectKey, sealed)
  return plain
}
