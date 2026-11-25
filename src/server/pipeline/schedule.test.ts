// FR-ONB-01: newly queued documents are processed in the patient's queue order, BATCH_CONCURRENCY runners at a time — not
// all at once. The queue order itself (nextWaiting: upload order, each batch in backlog order) is an integration test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runs = vi.hoisted(() => ({
  queue: [] as string[], started: [] as string[], runners: 0, active: 0, peak: 0, deadlines: [] as (number | undefined)[], busy: false,
  worked: false, waiting: [] as string[], queuedFor: [] as string[],
}))
vi.mock('./process', () => ({
  STALE_LOCK_MINUTES: 3,
  RUN_BUDGET_MS: 200_000,
  readSlotBusy: () => runs.busy,
  runDocument: async (_d: string, _o: string, opts?: { deadline?: number }) => { runs.deadlines.push(opts?.deadline); return runs.worked },
  runPatientQueue: async (p: string, _o: string, opts?: { deadline?: number }) => { // like the real one: take the next waiting document until none is left
    runs.runners++
    runs.queuedFor.push(p)
    runs.deadlines.push(opts?.deadline)
    for (let id = runs.queue.shift(); id; id = runs.queue.shift()) {
      runs.started.push(id)
      runs.peak = Math.max(runs.peak, ++runs.active)
      await new Promise((r) => setTimeout(r, 5))
      runs.active--
    }
    return false
  },
  nextWaitingPatient: async () => runs.waiting.shift() ?? null,
}))
vi.mock('next/server', () => ({ after: () => { throw new Error('outside a request') } })) // scripts and tests: runs at once

const { BATCH_CONCURRENCY, pollRunner, scheduleBatch, scheduleProcessing } = await import('./ingest')

describe('scheduleBatch', () => {
  it('runs the queue in order, never more than BATCH_CONCURRENCY at once', async () => {
    runs.deadlines.length = 0
    const ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']
    runs.queue.push(...ids)
    const at = Date.now()
    scheduleBatch('p1', ids.length, 'org')
    await vi.waitFor(() => expect(runs.started).toHaveLength(ids.length))
    expect(runs.started).toEqual(ids)
    expect(runs.runners).toBe(BATCH_CONCURRENCY)
    expect(runs.peak).toBe(BATCH_CONCURRENCY)
    // The function's time limit counts from the request: every runner's deadline is set when it is scheduled.
    expect(runs.deadlines).toHaveLength(BATCH_CONCURRENCY)
    for (const d of runs.deadlines) expect(d).toBeGreaterThanOrEqual(at + 200_000)
    for (const d of runs.deadlines) expect(d).toBeLessThan(at + 200_000 + 1_000)
  })

  it('a single upload\'s runner gets its deadline when it is scheduled too', async () => {
    runs.deadlines.length = 0
    const at = Date.now()
    scheduleProcessing('d1', 'org')
    await vi.waitFor(() => expect(runs.deadlines).toHaveLength(1))
    expect(runs.deadlines[0]).toBeGreaterThanOrEqual(at + 200_000)
    expect(runs.deadlines[0]).toBeLessThan(at + 200_000 + 1_000)
  })
})

describe('a run that worked hands on to the next waiting file (no screen open)', () => {
  const env = { VERCEL_ENV: process.env.VERCEL_ENV, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL, CRON_SECRET: process.env.CRON_SECRET }
  const fetches: { url: string; auth: string | null }[] = []
  beforeEach(() => {
    fetches.length = 0
    runs.queuedFor.length = 0
    runs.waiting.length = 0
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      fetches.push({ url, auth: new Headers(init?.headers).get('authorization') })
      return new Response('{}', { status: 200 })
    })
    Object.assign(process.env, { VERCEL_ENV: 'production', PUBLIC_BASE_URL: 'https://pilot.example.test', CRON_SECRET: 'cron-test-secret' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v
  })
  const settle = () => new Promise((r) => setTimeout(r, 50))

  it('in production: a fresh function call to the queue route, with the cron secret, when a file is waiting', async () => {
    runs.worked = true
    runs.waiting.push('p2', 'p2')
    scheduleProcessing('d1', 'org')
    await vi.waitFor(() => expect(fetches).toHaveLength(1))
    expect(fetches[0]).toEqual({ url: 'https://pilot.example.test/api/cron/queue', auth: 'Bearer cron-test-secret' })
    expect(runs.queuedFor).toEqual([]) // nothing started in this call: the fresh one has a full time budget
  })

  it('a run that did no work (another file is being read, or nothing to claim) calls nothing, so runners never loop', async () => {
    runs.worked = false
    runs.waiting.push('p2', 'p2')
    scheduleProcessing('d1', 'org')
    await settle()
    expect(fetches).toEqual([])
    expect(runs.queuedFor).toEqual([])
  })

  it('nothing waiting: nothing called', async () => {
    runs.worked = true
    scheduleProcessing('d1', 'org')
    await settle()
    expect(fetches).toEqual([])
    expect(runs.queuedFor).toEqual([])
  })

  it('outside production (a preview behind protection, a script) the next waiting patient starts in this call', async () => {
    delete process.env.VERCEL_ENV
    runs.worked = true
    runs.waiting.push('p2', 'p2')
    scheduleProcessing('d1', 'org')
    await vi.waitFor(() => expect(runs.queuedFor).toEqual(['p2']))
    expect(fetches).toEqual([])
  })

  it('no cron secret in production: starts in this call rather than calling unauthenticated', async () => {
    delete process.env.CRON_SECRET
    runs.worked = true
    runs.waiting.push('p2', 'p2')
    scheduleProcessing('d1', 'org')
    await vi.waitFor(() => expect(runs.queuedFor).toEqual(['p2']))
    expect(fetches).toEqual([])
  })
})

describe('pollRunner', () => {
  it('starts no runner while this instance is reading a file (it would stop at once)', async () => {
    runs.busy = true
    const before = runs.runners
    const tx = { select: () => ({ from: () => ({ where: async () => [{ n: 0 }] }) }) } // no document is being processed
    await pollRunner(tx as never, 'p1', 'org')
    await new Promise((r) => setTimeout(r, 50)) // a scheduled runner would have started by now
    expect(runs.runners).toBe(before)
    runs.busy = false
    await pollRunner(tx as never, 'p1', 'org') // control: free slot, one runner
    await vi.waitFor(() => expect(runs.runners).toBe(before + 1))
  })
})
