// Chunked uploads: the browser sends big files in chunks of at most CHUNK_BYTES (a Vercel request body is capped at 4.5 MB),
// the server keeps each chunk encrypted until the file is complete, then joins them, checks size and SHA-256 and hands the
// bytes to the normal upload path. Resumable: a session reports which chunks it already has, and a chunk can be re-sent.
// Chunks are deleted as soon as the file is assembled (or the session is aborted or expired).
// With an object store (S3_*), each encrypted chunk is kept there and its row holds only the metadata: an upload then costs
// the database's monthly network allowance (Neon's free plan: 5 GB) nothing, instead of the file's size when it is joined.
import { createHash } from 'node:crypto'
import { and, asc, count, eq, lt, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { uploadChunks, uploadSessions } from '@/db/schema'
import { CHUNK_BYTES, MAX_FILE_BYTES, MAX_ZIP_BYTES, objectBudgetBytes, storageBudgetBytes, UPLOAD_SESSION_HOURS } from '@/core/limits'
import { objectStore } from '@/server/objects'
import { decryptBytes, encryptBytes, encryptField } from '../crypto'
import { HttpError } from '../http'

export type StartInput = {
  orgId: string; patientId: string; uploader: { kind: 'staff' | 'patient' | 'caregiver'; id: string }
  fileName: string; totalSize: number; totalChunks: number; sha256: string; intakeRoute: string; encounterId?: string | null
  clientFileId?: string | null; clientCapturedAt?: Date | null // offline queue (0020): handed to intake when the file is assembled
}

/** Whether the declared file may start an upload: sizes against the caps, chunk count against the size. Pure. */
export function checkStart(i: Pick<StartInput, 'fileName' | 'totalSize' | 'totalChunks' | 'sha256'>): { ok: true } | { ok: false; code: string; message: string } {
  const cap = /\.zip$/i.test(i.fileName) ? MAX_ZIP_BYTES : MAX_FILE_BYTES
  if (!Number.isInteger(i.totalSize) || i.totalSize <= 0) return { ok: false, code: 'empty_file', message: 'The file is empty' }
  if (i.totalSize > cap) return { ok: false, code: 'file_too_large', message: `Files must be ${cap / 1048576} MB or smaller` }
  if (!/^[0-9a-f]{64}$/.test(i.sha256)) return { ok: false, code: 'invalid_request', message: 'A SHA-256 checksum is required' }
  const min = Math.ceil(i.totalSize / CHUNK_BYTES)
  if (!Number.isInteger(i.totalChunks) || i.totalChunks < min || i.totalChunks > Math.max(min, Math.ceil(i.totalSize / 262144))) return { ok: false, code: 'invalid_request', message: 'The chunk count does not fit the file size' }
  return { ok: true }
}

export async function startUpload(tx: Tx, i: StartInput): Promise<{ id: string; chunkBytes: number }> {
  const c = checkStart(i)
  if (!c.ok) throw new HttpError(c.code === 'file_too_large' ? 413 : 400, c.code, c.message)
  // The upload's chunks sit in the database until it is assembled; the file then goes to the database too, unless an object
  // store takes originals. Refuse before the quota is reached.
  const [{ used }] = await tx.execute<{ used: string }>(sql`select pg_database_size(current_database())::text as used`)
  if (Number(used) + (objectStore() ? 1 : 2) * i.totalSize > storageBudgetBytes()) throw new HttpError(507, 'storage_full', 'There is no room for this file on the server right now. Please hand it to the clinic desk.')
  if (objectStore()) {
    // ponytail: the sum is per organisation (RLS); one org per deployment today, a global sum needs the owner role
    const [{ stored }] = await tx.execute<{ stored: string }>(sql`select ((select coalesce(sum(size), 0) from document_files where object_key is not null)
      + (select coalesce(sum(size), 0) from voice_clips where object_key is not null))::text as stored`)
    if (Number(stored) + i.totalSize > objectBudgetBytes()) throw new HttpError(507, 'storage_full', 'There is no room for this file on the server right now. Please hand it to the clinic desk.')
  }
  const [row] = await tx.insert(uploadSessions).values({
    orgId: i.orgId, patientId: i.patientId, uploaderKind: i.uploader.kind, uploaderId: i.uploader.id, fileNameEnc: encryptField(i.fileName.slice(0, 200)),
    totalSize: i.totalSize, totalChunks: i.totalChunks, sha256: i.sha256, intakeRoute: i.intakeRoute, encounterId: i.encounterId ?? null,
    clientFileId: i.clientFileId ?? null, clientCapturedAt: i.clientCapturedAt ?? null, expiresAt: new Date(Date.now() + UPLOAD_SESSION_HOURS * 3600_000),
  }).returning({ id: uploadSessions.id })
  return { id: row.id, chunkBytes: CHUNK_BYTES }
}

async function ownSession(tx: Tx, sessionId: string, patientId: string, uploader: { kind: string; id: string }) {
  const [s] = await tx.select().from(uploadSessions).where(eq(uploadSessions.id, sessionId))
  // a session of another patient, another uploader or another org all look the same: not found
  if (!s || s.patientId !== patientId || s.uploaderId !== uploader.id || s.uploaderKind !== uploader.kind) throw new HttpError(404, 'not_found', 'Not found')
  if (s.state !== 'open') throw new HttpError(409, 'upload_closed', 'This upload is already finished')
  if (s.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'upload_expired', 'This upload took too long and expired. Please start again')
  return s
}

/** Object-store key of one chunk (encrypted, temporary). */
export const chunkKey = (orgId: string, sessionId: string, idx: number) => `u/${orgId}/${sessionId}/${idx}`

export async function putChunk(tx: Tx, a: { sessionId: string; patientId: string; uploader: { kind: string; id: string }; orgId: string; idx: number; bytes: Uint8Array }): Promise<{ received: number }> {
  const s = await ownSession(tx, a.sessionId, a.patientId, a.uploader)
  if (a.idx < 0 || a.idx >= s.totalChunks) throw new HttpError(400, 'invalid_request', 'Unknown chunk number')
  if (!a.bytes.length || a.bytes.length > CHUNK_BYTES + 1024) throw new HttpError(413, 'chunk_too_large', 'Chunk is too large')
  const { bytes, dekWrapped } = encryptBytes(Buffer.from(a.bytes))
  const store = objectStore()
  if (store) await store.put(chunkKey(a.orgId, s.id, a.idx), bytes) // an empty row below means "in the object store"
  const kept = store ? Buffer.alloc(0) : bytes
  await tx.insert(uploadChunks).values({ orgId: a.orgId, sessionId: s.id, idx: a.idx, bytesEnc: kept, dekWrapped, size: a.bytes.length })
    .onConflictDoUpdate({ target: [uploadChunks.sessionId, uploadChunks.idx], set: { bytesEnc: kept, dekWrapped, size: a.bytes.length } }) // re-sending a chunk replaces it
  const [{ n }] = await tx.select({ n: count() }).from(uploadChunks).where(eq(uploadChunks.sessionId, s.id))
  return { received: n }
}

/** Chunk numbers already stored, so an interrupted upload can carry on. */
export async function uploadStatus(tx: Tx, sessionId: string, patientId: string, uploader: { kind: string; id: string }): Promise<{ total: number; have: number[] }> {
  const s = await ownSession(tx, sessionId, patientId, uploader)
  const rows = await tx.select({ idx: uploadChunks.idx }).from(uploadChunks).where(eq(uploadChunks.sessionId, s.id)).orderBy(asc(uploadChunks.idx))
  return { total: s.totalChunks, have: rows.map((r) => r.idx) }
}

/** Joins the chunks and verifies size and checksum. A wrong checksum keeps the session so the browser can resend the bad chunk. */
export async function assemble(tx: Tx, sessionId: string, patientId: string, uploader: { kind: string; id: string }): Promise<{ bytes: Uint8Array; session: typeof uploadSessions.$inferSelect }> {
  const s = await ownSession(tx, sessionId, patientId, uploader)
  const rows = await tx.select().from(uploadChunks).where(eq(uploadChunks.sessionId, s.id)).orderBy(asc(uploadChunks.idx))
  if (rows.length !== s.totalChunks || rows.some((r, n) => r.idx !== n)) throw new HttpError(409, 'chunks_missing', 'Some parts of the file have not arrived yet')
  const store = objectStore()
  const parts: Buffer[] = []
  for (let i = 0; i < rows.length; i += 6) { // a few at a time from the object store
    parts.push(...await Promise.all(rows.slice(i, i + 6).map(async (r) => {
      if (r.bytesEnc.length) return decryptBytes(Buffer.from(r.bytesEnc), r.dekWrapped)
      if (!store) throw new HttpError(500, 'chunk_store_missing', 'Part of this upload is in object storage, which is not configured')
      return decryptBytes(Buffer.from(await store.get(chunkKey(r.orgId, s.id, r.idx))), r.dekWrapped)
    })))
  }
  const bytes = Buffer.concat(parts)
  if (bytes.length !== Number(s.totalSize)) throw new HttpError(422, 'size_mismatch', 'The file arrived with the wrong size. Please try again')
  if (createHash('sha256').update(bytes).digest('hex') !== s.sha256) throw new HttpError(422, 'checksum_mismatch', 'The file was damaged on the way. Please try again')
  return { bytes: new Uint8Array(bytes), session: s }
}

export async function closeSession(tx: Tx, sessionId: string, state: 'done' | 'aborted'): Promise<void> {
  const gone = await tx.delete(uploadChunks).where(eq(uploadChunks.sessionId, sessionId)).returning({ orgId: uploadChunks.orgId, idx: uploadChunks.idx, len: sql<number>`octet_length(${uploadChunks.bytesEnc})` })
  const store = objectStore()
  if (store) await Promise.all(gone.filter((r) => Number(r.len) === 0).map((r) => store.del(chunkKey(r.orgId, sessionId, r.idx))))
  await tx.update(uploadSessions).set({ state }).where(eq(uploadSessions.id, sessionId))
}

/** Housekeeping: removes chunks of sessions past their expiry. */
export async function purgeExpired(tx: Tx): Promise<number> {
  const old = await tx.select({ id: uploadSessions.id }).from(uploadSessions).where(and(eq(uploadSessions.state, 'open'), lt(uploadSessions.expiresAt, new Date())))
  for (const s of old) await closeSession(tx, s.id, 'aborted')
  return old.length
}
