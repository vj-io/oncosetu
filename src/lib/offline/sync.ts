// Upload the queue (E-OFF-02, E-DOC-18, V05-E2E-02). Client-only. A visit opened on this device is created first
// (idempotent on its UUIDv7). Each page goes as a resumable chunked upload keyed by its clientFileId: the session id is
// stored with the page, so after a dropped connection or a reload only the missing chunks are sent, and a retry after a
// lost answer never duplicates. The audio note is one request keyed by its own id. Confirmed files are wiped at once.
import { uploadChunked } from '@/lib/chunked-upload'
import { classifyResponse, isDue, markFailed, markPending, markSynced, startSync, type CaptureMeta } from './queue-state'
import {
  listCaptures, listPages, openCapturePatient, readPage, setPageUpload, updateCapture, wipeCapture, wipePage, type QueuedFile,
} from './store'

export type SyncOutcome = { synced: number; failed: number; authRequired: boolean; revoked: boolean }
type Sent = { outcome: ReturnType<typeof classifyResponse>; code: string }
const UPLOAD_TIMEOUT_MS = 60_000
/** The smallest chunk the server accepts: a dropped connection costs at most 256 KB of a page. */
export const OFFLINE_CHUNK_BYTES = 256 * 1024

async function errorCode(res: Response): Promise<string | null> {
  try { return ((await res.json()) as { error?: { code?: string } })?.error?.code ?? null } catch { return null }
}

/** A plain request: its answer classified, or 'retry' when the network failed. */
async function send(url: string, init: RequestInit): Promise<Sent> {
  try {
    const res = await fetch(url, { ...init, credentials: 'same-origin', signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) })
    return { outcome: classifyResponse(res.status, res.ok ? null : await errorCode(res)), code: res.ok ? 'ok' : `http_${res.status}` }
  } catch {
    return { outcome: 'retry', code: 'network' } // offline, DNS, timeout: try again with backoff
  }
}

async function uploadFile(key: CryptoKey, f: QueuedFile, c: CaptureMeta, patientId: string, encounterId: string, headers: Record<string, string>): Promise<Sent> {
  const blob = await readPage(key, f)
  if (f.kind === 'audio') {
    const form = new FormData()
    form.set('file', blob, 'note.webm')
    form.set('clientFileId', f.clientFileId)
    form.set('encounterId', encounterId)
    form.set('seconds', String(f.seconds))
    return send(`/api/patients/${patientId}/audio-notes`, { method: 'POST', body: form, headers })
  }
  try {
    const r = await uploadChunked(`/api/patients/${patientId}/uploads`, blob, `page-${f.order + 1}.jpg`, () => {}, {
      chunkBytes: OFFLINE_CHUNK_BYTES, headers, sessionId: f.uploadId,
      onSession: (id) => setPageUpload(f.clientFileId, id),
      fields: {
        clientFileId: f.clientFileId, intakeRoute: c.offline ? 'offline_sync' : 'desk', encounterId,
        clientCapturedAt: new Date(c.capturedAt).toISOString(), // stored as client_captured_at only (E-OFF-03)
      },
    })
    if (r.status === 0) return { outcome: 'retry', code: 'network' }
    return { outcome: classifyResponse(r.status, r.code ?? null), code: r.status === 200 ? 'ok' : `http_${r.status}` }
  } catch {
    return { outcome: 'retry', code: 'network' }
  }
}

async function run(key: CryptoKey, deviceId: string | null, onChange: () => void): Promise<SyncOutcome> {
  const out: SyncOutcome = { synced: 0, failed: 0, authRequired: false, revoked: false }
  const headers: Record<string, string> = deviceId ? { 'x-device-id': deviceId } : {}
  for (const c0 of await listCaptures()) {
    if (!navigator.onLine || out.authRequired || out.revoked) break
    if (!isDue(c0, Date.now())) continue
    let c = startSync(c0)
    await updateCapture(c)
    onChange()
    let failure: { code: string; retryable: boolean } | null = null
    try {
      const { encounterId, patientId, newEncounter } = await openCapturePatient(key, c.id)
      const steps: (() => Promise<Sent>)[] = []
      if (newEncounter) {
        steps.push(() => send(`/api/patients/${patientId}/encounters`, {
          method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ id: encounterId, clientCapturedAt: new Date(c.capturedAt).toISOString() }),
        }))
      }
      for (const f of await listPages(c.id)) {
        steps.push(async () => {
          const r = await uploadFile(key, f, c, patientId, encounterId, headers)
          if (r.outcome === 'ok') await wipePage(f.clientFileId)
          return r
        })
      }
      for (const step of steps) {
        const r = await step()
        if (r.outcome === 'ok') continue
        if (r.outcome === 'revoked') { out.revoked = true; return out } // caller wipes everything
        if (r.outcome === 'auth') { out.authRequired = true; break }
        failure = { code: r.code, retryable: r.outcome === 'retry' }
        break
      }
    } catch {
      failure = { code: 'unreadable', retryable: false } // ciphertext failed to open: cannot be fixed by retrying
    }
    if (out.authRequired) c = markPending(c)
    else if (failure) { c = markFailed(c, failure.code, failure.retryable, Date.now()); out.failed++ }
    else { markSynced(c); await wipeCapture(c.id); out.synced++; onChange(); continue }
    await updateCapture(c)
    onChange()
  }
  return out
}

let inflight: Promise<SyncOutcome> | null = null

/** Single-flight in this tab, and across tabs via Web Locks, so two syncs never race on the same item. */
export function syncQueue(key: CryptoKey, deviceId: string | null, onChange: () => void): Promise<SyncOutcome> {
  // A caller that joins a run already in flight gets its flags but not its counts: only the starter reports "N synced".
  if (inflight) return inflight.then((o) => ({ ...o, synced: 0, failed: 0 }))
  inflight = (async () => {
    const go = () => run(key, deviceId, onChange)
    if (!navigator.locks) return go()
    const r = await navigator.locks.request('oncosetu-capture-sync', { ifAvailable: true }, (lock) => (lock ? go() : null))
    return r ?? { synced: 0, failed: 0, authRequired: false, revoked: false }
  })().finally(() => { inflight = null })
  return inflight
}
