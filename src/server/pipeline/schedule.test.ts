// FR-ONB-01: a batch is processed in the order given (backlog order), BATCH_CONCURRENCY at a time — not all at once.
import { describe, expect, it, vi } from 'vitest'

const runs = vi.hoisted(() => ({ started: [] as string[], active: 0, peak: 0 }))
vi.mock('./process', () => ({
  runDocument: async (id: string) => {
    runs.started.push(id)
    runs.peak = Math.max(runs.peak, ++runs.active)
    await new Promise((r) => setTimeout(r, 5))
    runs.active--
  },
}))
vi.mock('next/server', () => ({ after: () => { throw new Error('outside a request') } })) // scripts and tests: runs at once

const { BATCH_CONCURRENCY, scheduleBatch } = await import('./ingest')

describe('scheduleBatch', () => {
  it('starts documents in the order given, never more than BATCH_CONCURRENCY at once', async () => {
    const ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']
    scheduleBatch(ids, 'org')
    await vi.waitFor(() => expect(runs.started).toHaveLength(ids.length))
    expect(runs.started).toEqual(ids)
    expect(runs.peak).toBe(BATCH_CONCURRENCY)
  })
})
