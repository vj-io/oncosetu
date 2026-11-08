// The encrypted offline queue on IndexedDB (FR-OFF-02/03). Client-only.
// Plaintext on disk: ids, states, counts, timestamps. Everything about the patient and every page is ciphertext.
import { v7 as uuidv7 } from 'uuid'
import { createKeyBundle, open, openJson, seal, sealJson, unlockKey, type KeyBundle, type Sealed } from './crypto'
import { deleteDatabase, delOne, getAll, getOne, putOne, tx, wrap } from './idb'
import { markPending, type CaptureMeta } from './queue-state'

/** Who a capture belongs to. Cached encrypted so a patient can be chosen offline. */
export type CapturePatient = {
  encounterId: string; patientId: string; name: string; mrn: string | null; ageYears: number | null
  type: string; startedAt: string
  /** The visit was opened on this device (client UUIDv7, FR-OFF-02): the server creates it on sync, before the pages. */
  newEncounter?: boolean
}
/** A patient seen recently, for whom records/clinician staff may open a new visit offline. */
export type RecentPatient = { patientId: string; name: string; mrn: string | null; ageYears: number | null; lastVisitAt: string }
type CaptureRecord = CaptureMeta & { patient: Sealed }
/**
 * One queued file: a page (JPEG) or the capture's audio note. `uploadId` is the server's chunked-upload session, kept so a
 * reloaded browser resumes the chunks still missing (V05-E2E-02). Ids, order, kind and length are the only plaintext.
 */
type PageRecord = { clientFileId: string; captureId: string; order: number; sealed: Sealed; kind?: 'audio'; mime?: string; seconds?: number; uploadId?: string }
export type QueuedFile = { clientFileId: string; order: number; kind: 'page' | 'audio'; mime: string; seconds: number; uploadId: string | null }

const DEVICE_KEY = 'oncosetu.capture.device'

// ── device id (survives logout: it identifies the tablet, not the person) ───────
export type DeviceInfo = { deviceId: string; label: string }
export function getDevice(): DeviceInfo | null {
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null') } catch { return null }
}
export const setDevice = (d: DeviceInfo) => localStorage.setItem(DEVICE_KEY, JSON.stringify(d))
export const clearDevice = () => localStorage.removeItem(DEVICE_KEY)
// the name staff gave the tablet at PIN setup; used if registration has to wait for the network
const LABEL_KEY = 'oncosetu.capture.label'
export const getDeviceLabel = () => localStorage.getItem(LABEL_KEY)
export const setDeviceLabel = (l: string) => localStorage.setItem(LABEL_KEY, l)

// ── key ─────────────────────────────────────────────────────────────────────────
export const hasKeyBundle = async () => !!(await getOne('meta', 'keybundle'))

export async function setPin(pin: string): Promise<CryptoKey> {
  const { bundle, key } = await createKeyBundle(pin)
  await putOne('meta', { k: 'keybundle', ...bundle })
  return key
}

export async function unlockWithPin(pin: string): Promise<CryptoKey> {
  const row = await getOne<KeyBundle & { k: string }>('meta', 'keybundle')
  if (!row) throw new Error('no_key')
  return unlockKey(row, pin)
}

// ── cached patient list ─────────────────────────────────────────────────────────
export type CaptureList = { items: CapturePatient[]; recent: RecentPatient[] }
export const saveCaptureList = async (key: CryptoKey, list: CaptureList) =>
  putOne('meta', { k: 'captureList', savedAt: Date.now(), ...(await sealJson(key, list, 'captureList')) })

export async function loadCaptureList(key: CryptoKey): Promise<CaptureList & { savedAt: number } | null> {
  const row = await getOne<{ savedAt: number } & Sealed>('meta', 'captureList')
  if (!row) return null
  const v = await openJson<CaptureList | CapturePatient[]>(key, row, 'captureList')
  return { ...(Array.isArray(v) ? { items: v, recent: [] } : v), savedAt: row.savedAt } // an array: saved before `recent` existed
}

// ── queue ───────────────────────────────────────────────────────────────────────
export type NewCapture = { patient: CapturePatient; pages: Blob[]; audio?: { blob: Blob; seconds: number } | null; offline: boolean }

/** Seal and store a capture, its pages and its audio note in one transaction. Returns the capture id (UUIDv7). */
export async function enqueueCapture(key: CryptoKey, c: NewCapture): Promise<string> {
  const id = uuidv7()
  const meta: CaptureRecord = {
    id, state: 'pending', capturedAt: Date.now(), pageCount: c.pages.length, audio: !!c.audio, attempts: 0, nextAttemptAt: null,
    lastError: null, offline: c.offline, patient: await sealJson(key, c.patient, id),
  }
  const pages: PageRecord[] = []
  const sealFile = async (blob: Blob, order: number, extra: Partial<PageRecord> = {}) => {
    const clientFileId = uuidv7() // per-file idempotency key (E-OFF-02, E-DOC-18)
    pages.push({ clientFileId, captureId: id, order, sealed: await seal(key, new Uint8Array(await blob.arrayBuffer()), clientFileId), ...extra })
  }
  for (const [order, blob] of c.pages.entries()) await sealFile(blob, order)
  if (c.audio) await sealFile(c.audio.blob, c.pages.length, { kind: 'audio', mime: c.audio.blob.type || 'audio/webm', seconds: c.audio.seconds })
  await tx(['captures', 'pages'], 'readwrite', async (os) => {
    await wrap(os('captures').put(meta))
    for (const p of pages) await wrap(os('pages').put(p))
  })
  return id
}

const plain = (r: CaptureRecord): CaptureMeta => ({
  id: r.id, state: r.state, capturedAt: r.capturedAt, pageCount: r.pageCount, audio: r.audio, attempts: r.attempts,
  nextAttemptAt: r.nextAttemptAt, lastError: r.lastError, offline: r.offline,
})

export async function listCaptures(): Promise<CaptureMeta[]> {
  const rows = await getAll<CaptureRecord>('captures')
  return rows.map(plain).sort((a, b) => a.capturedAt - b.capturedAt)
}

export async function updateCapture(m: CaptureMeta): Promise<void> {
  await tx(['captures'], 'readwrite', async (os) => {
    const cur = await wrap<CaptureRecord | undefined>(os('captures').get(m.id))
    if (cur) await wrap(os('captures').put({ ...m, patient: cur.patient }))
  })
}

export async function openCapturePatient(key: CryptoKey, id: string): Promise<CapturePatient> {
  const row = await getOne<CaptureRecord>('captures', id)
  if (!row) throw new Error('missing_capture')
  return openJson<CapturePatient>(key, row.patient, id)
}

export async function listPages(captureId: string): Promise<QueuedFile[]> {
  const rows = await tx(['pages'], 'readonly', (os) => wrap<PageRecord[]>(os('pages').index('byCapture').getAll(captureId)))
  return rows.map((r) => ({
    clientFileId: r.clientFileId, order: r.order, kind: r.kind ?? 'page' as const, mime: r.mime ?? 'image/jpeg', seconds: r.seconds ?? 0, uploadId: r.uploadId ?? null,
  })).sort((a, b) => a.order - b.order)
}

export async function readPage(key: CryptoKey, f: Pick<QueuedFile, 'clientFileId' | 'mime'>): Promise<Blob> {
  const row = await getOne<PageRecord>('pages', f.clientFileId)
  if (!row) throw new Error('missing_page')
  return new Blob([await open(key, row.sealed, f.clientFileId)], { type: f.mime })
}

/** Remember the server's upload session for this file, so a reload resumes it instead of starting over. */
export async function setPageUpload(clientFileId: string, uploadId: string): Promise<void> {
  await tx(['pages'], 'readwrite', async (os) => {
    const cur = await wrap<PageRecord | undefined>(os('pages').get(clientFileId))
    if (cur) await wrap(os('pages').put({ ...cur, uploadId }))
  })
}

/** Confirmed upload: the page's ciphertext is deleted at once. */
export const wipePage = (clientFileId: string) => delOne('pages', clientFileId)

/** Remove a capture and any pages it still holds (after sync, or when staff discard it). */
export async function wipeCapture(id: string): Promise<void> {
  await tx(['captures', 'pages'], 'readwrite', async (os) => {
    const keys = await wrap<IDBValidKey[]>(os('pages').index('byCapture').getAllKeys(id))
    for (const k of keys) await wrap(os('pages').delete(k))
    await wrap(os('captures').delete(id))
  })
}

/** A reload during a sync leaves items 'syncing': put them back in line (their pages are idempotent on the server). */
export async function recoverInterrupted(): Promise<void> {
  for (const c of await listCaptures()) if (c.state === 'syncing') await updateCapture(markPending(c))
}

/** Logout, revoked device, PIN reset: everything on this device goes (key, queue, cached patient list). */
export const wipeAll = () => deleteDatabase()
