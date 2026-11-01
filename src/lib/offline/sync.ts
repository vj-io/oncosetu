// Upload the queue (E-OFF-02, E-DOC-18). Client-only. One page = one POST to the documents endpoint, keyed by its
// clientFileId, so a retry after a dropped response never duplicates. Confirmed pages are wiped at once.
import { classifyResponse, isDue, markFailed, markPending, markSynced, startSync, type CaptureMeta } from './queue-state'
import {
  listCaptures, listPages, openCapturePatient, readPage, updateCapture, wipeCapture, wipePage,
} from './store'

export type SyncOutcome = { synced: number; failed: number; authRequired: boolean; revoked: boolean }
const UPLOAD_TIMEOUT_MS = 60_000

async function errorCode(res: Response): Promise<string | null> {
  try { return ((await res.json()) as { error?: { code?: string } })?.error?.code ?? null } catch { return null }
}

async function uploadPage(
  endpoint: string, deviceId: string | null, clientFileId: string, page: Blob,
  c: CaptureMeta, encounterId: string, order: number,
): Promise<{ outcome: ReturnType<typeof classifyResponse>; code: string }> {
  const form = new FormData()
  form.set('file', page, `page-${order + 1}.jpg`)
  form.set('clientFileId', clientFileId)
  form.set('intakeRoute', c.offline ? 'offline_sync' : 'desk')
  form.set('encounterId', encounterId)
  form.set('clientCapturedAt', new Date(c.capturedAt).toISOString()) // stored as client_captured_at only (E-OFF-03)
  try {
    const res = await fetch(endpoint, {
      method: 'POST', body: form, headers: deviceId ? { 'x-device-id': deviceId } : {}, credentials: 'same-origin',
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
    const outcome = classifyResponse(res.status, res.ok ? null : await errorCode(res))
    return { outcome, code: res.ok ? 'ok' : `http_${res.status}` }
  } catch {
    return { outcome: 'retry', code: 'network' } // offline, DNS, timeout: try again with backoff
  }
}

async function run(key: CryptoKey, deviceId: string | null, onChange: () => void): Promise<SyncOutcome> {
  const out: SyncOutcome = { synced: 0, failed: 0, authRequired: false, revoked: false }
  for (const c0 of await listCaptures()) {
    if (!navigator.onLine || out.authRequired || out.revoked) break
    if (!isDue(c0, Date.now())) continue
    let c = startSync(c0)
    await updateCapture(c)
    onChange()
    let failure: { code: string; retryable: boolean } | null = null
    try {
      const { encounterId, patientId } = await openCapturePatient(key, c.id)
      const endpoint = `/api/patients/${patientId}/documents`
      for (const p of await listPages(c.id)) {
        const r = await uploadPage(endpoint, deviceId, p.clientFileId, await readPage(key, p.clientFileId), c, encounterId, p.order)
        if (r.outcome === 'ok') { await wipePage(p.clientFileId); continue }
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
  inflight ??= (async () => {
    const go = () => run(key, deviceId, onChange)
    if (!navigator.locks) return go()
    const r = await navigator.locks.request('oncosetu-capture-sync', { ifAvailable: true }, (lock) => (lock ? go() : null))
    return r ?? { synced: 0, failed: 0, authRequired: false, revoked: false }
  })().finally(() => { inflight = null })
  return inflight
}
