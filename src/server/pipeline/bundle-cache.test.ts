import { describe, expect, it } from 'vitest'
import { makeBundleCache } from './bundle-cache'

const bytes = (n: number) => new Uint8Array(n)

describe('bundle cache (a study part read once per instance, not once per slice)', () => {
  it('reads a part once, then serves every slice from memory', async () => {
    const c = makeBundleCache(100, 60_000)
    let reads = 0
    const load = async () => { reads++; return bytes(10) }
    for (let i = 0; i < 5; i++) await c.get('a', load, 1000)
    expect(reads).toBe(1)
  })

  it('slices asked for at the same time share one read', async () => {
    const c = makeBundleCache(100, 60_000)
    let reads = 0
    const load = () => new Promise<Uint8Array>((r) => { reads++; setTimeout(() => r(bytes(10)), 5) })
    await Promise.all([c.get('a', load), c.get('a', load), c.get('a', load)])
    expect(reads).toBe(1)
  })

  it('keeps at most maxBytes, dropping the least recently used part', async () => {
    const c = makeBundleCache(25, 60_000)
    const reads: string[] = []
    const load = (id: string) => async () => { reads.push(id); return bytes(10) }
    await c.get('a', load('a'), 1); await c.get('b', load('b'), 2)
    await c.get('a', load('a'), 3) // a is now the most recent
    await c.get('c', load('c'), 4) // 30 > 25: b goes
    expect(c.size).toBe(20)
    await c.get('a', load('a'), 5); await c.get('b', load('b'), 6)
    expect(reads).toEqual(['a', 'b', 'c', 'b'])
  })

  it('forgets a part after ttl without use, and never keeps a part larger than the whole cache or a failed read', async () => {
    const c = makeBundleCache(25, 1000)
    let reads = 0
    const load = async () => { reads++; return bytes(10) }
    await c.get('a', load, 0); await c.get('a', load, 900); await c.get('a', load, 1800) // used within ttl each time
    expect(reads).toBe(1)
    await c.get('a', load, 3000) // 1200 ms unused
    expect(reads).toBe(2)
    expect(await c.get('big', async () => bytes(30), 3000)).toHaveLength(30)
    expect(await c.get('gone', async () => null, 3000)).toBeNull()
    expect(c.size).toBe(10)
  })
})
