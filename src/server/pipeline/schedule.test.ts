// FR-ONB-01: newly queued documents are processed in the patient's queue order, BATCH_CONCURRENCY runners at a time — not
// all at once. The queue order itself (nextWaiting: upload order, each batch in backlog order) is an integration test.
import { describe, expect, it, vi } from 'vitest'

const runs = vi.hoisted(() => ({ queue: [] as string[], started: [] as string[], runners: 0, active: 0, peak: 0, deadlines: [] as (number | undefined)[], busy: false }))
vi.mock('./process', () => ({
  STALE_LOCK_MINUTES: 3,
  RUN_BUDGET_MS: 200_000,
  readSlotBusy: () => runs.busy,
  runDocument: async (_d: string, _o: string, opts?: { deadline?: number }) => { runs.deadlines.push(opts?.deadline) },
  runPatientQueue: async (_p: string, _o: string, opts?: { deadline?: number }) => { // like the real one: take the next waiting document until none is left
    runs.runners++
    runs.deadlines.push(opts?.deadline)
    for (let id = runs.queue.shift(); id; id = runs.queue.shift()) {
      runs.started.push(id)
      runs.peak = Math.max(runs.peak, ++runs.active)
      await new Promise((r) => setTimeout(r, 5))
      runs.active--
    }
  },
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
