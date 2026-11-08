// FR-ONB-01: newly queued documents are processed in the patient's queue order, BATCH_CONCURRENCY runners at a time — not
// all at once. The queue order itself (nextWaiting: upload order, each batch in backlog order) is an integration test.
import { describe, expect, it, vi } from 'vitest'

const runs = vi.hoisted(() => ({ queue: [] as string[], started: [] as string[], runners: 0, active: 0, peak: 0 }))
vi.mock('./process', () => ({
  STALE_LOCK_MINUTES: 3,
  runPatientQueue: async () => { // like the real one: take the next waiting document until none is left
    runs.runners++
    for (let id = runs.queue.shift(); id; id = runs.queue.shift()) {
      runs.started.push(id)
      runs.peak = Math.max(runs.peak, ++runs.active)
      await new Promise((r) => setTimeout(r, 5))
      runs.active--
    }
  },
}))
vi.mock('next/server', () => ({ after: () => { throw new Error('outside a request') } })) // scripts and tests: runs at once

const { BATCH_CONCURRENCY, scheduleBatch } = await import('./ingest')

describe('scheduleBatch', () => {
  it('runs the queue in order, never more than BATCH_CONCURRENCY at once', async () => {
    const ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']
    runs.queue.push(...ids)
    scheduleBatch('p1', ids.length, 'org')
    await vi.waitFor(() => expect(runs.started).toHaveLength(ids.length))
    expect(runs.started).toEqual(ids)
    expect(runs.runners).toBe(BATCH_CONCURRENCY)
    expect(runs.peak).toBe(BATCH_CONCURRENCY)
  })
})
