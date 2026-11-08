// Single-flight sync (CaptureApp starts a sync on reconnect, on save and on a timer): a caller that joins a run already
// in flight must not report that run's count again, or the desk sees "1 capture synced" once per caller.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureMeta } from './queue-state'

const cap: CaptureMeta = { id: 'c1', state: 'pending', capturedAt: 1_000, pageCount: 0, attempts: 0, nextAttemptAt: null, lastError: null, offline: true }
let queue: CaptureMeta[] = []
vi.mock('./store', () => ({
  listCaptures: vi.fn(async () => queue),
  listPages: vi.fn(async () => []), // no pages: the capture syncs with no request
  openCapturePatient: vi.fn(async () => ({ encounterId: 'e1', patientId: 'p1', newEncounter: false })),
  readPage: vi.fn(), setPageUpload: vi.fn(), updateCapture: vi.fn(async () => {}), wipePage: vi.fn(),
  wipeCapture: vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); queue = [] }),
}))
vi.mock('@/lib/chunked-upload', () => ({ uploadChunked: vi.fn() }))

beforeEach(() => { queue = [cap]; vi.stubGlobal('navigator', { onLine: true }) })
afterEach(() => vi.unstubAllGlobals())

describe('syncQueue', () => {
  it('reports each synced capture once, however many callers join the run', async () => {
    const { syncQueue } = await import('./sync')
    const key = {} as CryptoKey
    const outs = await Promise.all([syncQueue(key, 'd1', () => {}), syncQueue(key, 'd1', () => {}), syncQueue(key, 'd1', () => {})])
    expect(outs.map((o) => o.synced)).toEqual([1, 0, 0])
    expect((await syncQueue(key, 'd1', () => {})).synced).toBe(0) // the queue is empty now
  })
})
