// The in-tab cache of drawn PDF pages: a file is downloaded and parsed once and each page drawn once while it is being
// viewed (Page ↔ Words, a remount, several report sections of one file), never longer than one viewing, at most a few
// files, and nothing at all after sign-out.
import { describe, expect, it } from 'vitest'
import { KEEP_MS, MAX_FILES, makePageCache } from './drawn-pages'

function harness() {
  const calls = { load: [] as string[], render: [] as string[], destroyed: [] as string[] }
  let t = 0
  let failLoad = false
  let failRender = false
  const cache = makePageCache<{ src: string; numPages: number; destroy: () => void }>({
    now: () => t,
    load: async (src) => {
      calls.load.push(src)
      if (failLoad) throw new Error('network')
      return { src, numPages: 3, destroy: () => calls.destroyed.push(src) }
    },
    render: async (pdf, n) => {
      calls.render.push(`${pdf.src}#${n}`)
      if (failRender) throw new Error('draw')
      return `data:${pdf.src}#${n}`
    },
  })
  return { cache, calls, tick: (ms: number) => { t += ms }, failLoad: (v: boolean) => { failLoad = v }, failRender: (v: boolean) => { failRender = v } }
}

describe('drawn pages cache', () => {
  it('a file opened again (Words and back, a remount, another section of the file) is downloaded and each page drawn once', async () => {
    const h = harness()
    const a = h.cache.open('/f/1')
    expect(await a.page(1)).toBe('data:/f/1#1')
    expect(await a.page(2)).toBe('data:/f/1#2')
    const again = h.cache.open('/f/1')
    expect(await again.page(1)).toBe('data:/f/1#1')
    expect(await again.page(2)).toBe('data:/f/1#2')
    expect((await again.pdf).numPages).toBe(3)
    expect(h.calls.load).toEqual(['/f/1'])
    expect(h.calls.render).toEqual(['/f/1#1', '/f/1#2'])
  })

  it('two viewers asking at the same moment share one download and one drawing', async () => {
    const h = harness()
    const [x, y] = await Promise.all([h.cache.open('/f/1').page(1), h.cache.open('/f/1').page(1)])
    expect([x, y]).toEqual(['data:/f/1#1', 'data:/f/1#1'])
    expect(h.calls.load).toEqual(['/f/1'])
    expect(h.calls.render).toEqual(['/f/1#1'])
  })

  it('a failed download or drawing is not kept, so the next try fetches or draws again', async () => {
    const h = harness()
    h.failLoad(true)
    await expect(h.cache.open('/f/1').page(1)).rejects.toThrow('network')
    h.failLoad(false)
    expect(await h.cache.open('/f/1').page(1)).toBe('data:/f/1#1')
    expect(h.calls.load).toEqual(['/f/1', '/f/1'])
    h.failRender(true)
    await expect(h.cache.open('/f/1').page(2)).rejects.toThrow('draw')
    h.failRender(false)
    expect(await h.cache.open('/f/1').page(2)).toBe('data:/f/1#2')
    expect(h.calls.render).toEqual(['/f/1#1', '/f/1#2', '/f/1#2'])
  })

  it('kept for one viewing only: after KEEP_MS the file is fetched again (the server audits a new viewing)', async () => {
    const h = harness()
    await h.cache.open('/f/1').page(1)
    h.tick(KEEP_MS - 1)
    await h.cache.open('/f/1').page(1)
    expect(h.calls.load).toEqual(['/f/1'])
    h.tick(2)
    await h.cache.open('/f/1').page(1)
    expect(h.calls.load).toEqual(['/f/1', '/f/1'])
    expect(h.calls.destroyed).toEqual(['/f/1'])
  })

  it(`at most ${MAX_FILES} files: opening another drops the one opened longest ago`, async () => {
    const h = harness()
    for (let i = 1; i <= MAX_FILES + 1; i++) await h.cache.open(`/f/${i}`).page(1)
    expect(h.calls.destroyed).toEqual(['/f/1'])
    await h.cache.open('/f/2').page(1) // still kept
    expect(h.calls.load).toEqual(Array.from({ length: MAX_FILES + 1 }, (_, i) => `/f/${i + 1}`))
    await h.cache.open('/f/1').page(1) // dropped: fetched again
    expect(h.calls.load.at(-1)).toBe('/f/1')
  })

  it('clear (sign-out) drops every file, so nothing drawn for one person is shown to the next', async () => {
    const h = harness()
    await h.cache.open('/f/1').page(1)
    await h.cache.open('/f/2').page(1)
    h.cache.clear()
    await new Promise((r) => setTimeout(r, 0))
    expect(h.calls.destroyed.sort()).toEqual(['/f/1', '/f/2'])
    await h.cache.open('/f/1').page(1)
    expect(h.calls.load).toEqual(['/f/1', '/f/2', '/f/1'])
  })
})
