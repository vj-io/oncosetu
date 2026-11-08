// Calibration set: the four JPEG demo documents (photographed-paper renders), degraded with sharp.
import { join } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { describe, expect, it } from 'vitest'
import { analyse, ANALYSIS_MAX_SIDE, type Raster } from './quality'

const DOCS = ['hero__03-ct-thorax-abdomen.jpg', 'hero__05-prescription-handwritten.jpg', 'hero__06-cbc-hindi.jpg', 'returning__04-lab-cbc-lft.jpg']
const path = (f: string) => join(process.cwd(), 'public', 'demo-docs', f)

async function check(img: Sharp) {
  const { width, height } = await img.metadata()
  const { data, info } = await img.clone().resize({ width: ANALYSIS_MAX_SIDE, height: ANALYSIS_MAX_SIDE, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const raster: Raster = { data, width: info.width, height: info.height }
  return analyse(raster, { width: width!, height: height! })
}
const from = async (b: Buffer | Sharp) => sharp(Buffer.isBuffer(b) ? b : await b.toBuffer())

describe.each(DOCS)('quality check on %s (FR-DOC-03)', (file) => {
  const original = () => sharp(path(file))

  it('passes the clean page', async () => {
    expect((await check(original())).issues).toEqual([])
  })
  it('flags heavy blur', async () => {
    expect((await check(await from(original().blur(6)))).issues).toContain('blurry')
  })
  it('keeps mild blur (text still readable)', async () => {
    expect((await check(await from(original().blur(2)))).issues).not.toContain('blurry')
  })
  it('flags an underexposed page', async () => {
    expect((await check(await from(original().linear(0.35, 0)))).issues).toContain('too_dark')
  })
  it('flags a low-resolution page', async () => {
    expect((await check(await from(original().resize({ width: 600 })))).issues).toContain('too_small')
  })
  it('flags a page cut off at an edge', async () => {
    const m = await original().metadata()
    const cut = original().extract({ left: Math.round(m.width! * 0.15), top: 0, width: Math.round(m.width! * 0.85), height: m.height! })
    expect((await check(await from(cut))).issues).toContain('cropped')
  })
  it('flags a page tilted by 8°, keeps a 2° tilt', async () => {
    const tilt = async (deg: number) => check(sharp(await original().rotate(deg, { background: '#fff' }).toBuffer()))
    expect((await tilt(8)).issues).toContain('skewed')
    expect((await tilt(-8)).issues).toContain('skewed')
    expect((await tilt(2)).issues).not.toContain('skewed')
  })
  it('flags a glare patch, but not a clean white page', async () => {
    const m = await original().metadata()
    const dim = await original().linear(0.85, 0).toBuffer() // paper at ~217, so a pure-white patch stands out
    const patch = (rx: number) => Buffer.from(`<svg width="${m.width}" height="${m.height}"><ellipse cx="${m.width! * 0.6}" cy="${m.height! * 0.35}" rx="${m.width! * rx}" ry="${m.height! * rx}" fill="#fff"/></svg>`)
    expect((await check(sharp(await sharp(dim).composite([{ input: patch(0.17) }]).toBuffer()))).issues).toContain('glare')
    expect((await check(sharp(dim))).issues).not.toContain('glare')
  })
})

it('reports measurements alongside the verdict', async () => {
  const r = await check(sharp(path(DOCS[0])))
  expect(r.ok).toBe(true)
  expect(r.metrics.sharpness).toBeGreaterThan(1000)
  expect(r.metrics.paperLuma).toBeGreaterThan(150)
})

describe('skew (projection profile) on a synthetic page', () => {
  // A4 at 150 dpi: 30 lines of word-like bars, the shape text lines give the projection profile.
  const W = 1240, H = 1754
  const bars = Array.from({ length: 30 }, (_, l) => Array.from({ length: 9 }, (_, k) =>
    `<rect x="${120 + k * 110}" y="${150 + l * 48}" width="${60 + ((l * 7 + k * 13) % 40)}" height="16" fill="#222"/>`).join('')).join('')
  const page = () => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>${bars}</svg>`)).flatten({ background: '#fff' })
  const tilted = async (deg: number) => check(sharp(await page().rotate(deg, { background: '#fff' }).png().toBuffer()))

  it('reads a straight page as straight', async () => {
    const r = await check(sharp(await page().png().toBuffer()))
    expect(Math.abs(r.metrics.skewDeg)).toBeLessThanOrEqual(0.5)
    expect(r.issues).not.toContain('skewed')
  })
  it('measures the tilt and its direction, and flags it', async () => {
    for (const deg of [7, -7, 12]) {
      const r = await tilted(deg)
      expect(Math.abs(r.metrics.skewDeg - deg)).toBeLessThanOrEqual(1)
      expect(r.issues).toContain('skewed')
    }
    expect((await tilted(3)).issues).not.toContain('skewed')
  })
})

// FR-DOC-03 acceptance: "flags at least 80 % of bad pages". An eval set of 60 bad pages (each demo page blurred, glared,
// darkened, tilted and cut off at several strengths) and 20 good ones (clean, plus changes staff should not have to retake).
// The thresholds were set on these same four pages, so this is a regression gate, not a held-out measurement.
describe('bad-page recall over a degraded eval set (FR-DOC-03)', () => {
  type Bg = { r: number; g: number; b: number }
  type Case = { kind: 'blur' | 'glare' | 'dark' | 'skew' | 'cut' | 'good'; issue?: string; make: (o: () => Sharp, w: number, h: number, bg: Bg) => Promise<Sharp> }
  const buf = async (s: Sharp) => sharp(await s.toBuffer())
  const glare = (rx: number) => async (o: () => Sharp, w: number, h: number) => {
    const svg = Buffer.from(`<svg width="${w}" height="${h}"><ellipse cx="${w * 0.45}" cy="${h * 0.55}" rx="${w * rx}" ry="${h * rx * 0.8}" fill="#fff"/></svg>`)
    return sharp(await sharp(await o().linear(0.85, 0).toBuffer()).composite([{ input: svg }]).toBuffer())
  }
  const cut = (side: 'left' | 'right' | 'top' | 'bottom', f: number) => async (o: () => Sharp, w: number, h: number) => {
    const r = { left: 0, top: 0, width: w, height: h }
    if (side === 'left' || side === 'right') { r.width = Math.round(w * (1 - f)); if (side === 'left') r.left = w - r.width }
    else { r.height = Math.round(h * (1 - f)); if (side === 'top') r.top = h - r.height }
    return buf(o().extract(r))
  }
  // the corners a rotation opens are filled with the photo's own surround, as a tilted photo would show it
  const tilt = (deg: number) => async (o: () => Sharp, _w: number, _h: number, bg: Bg) => buf(o().rotate(deg, { background: bg }))
  const CASES: Case[] = [
    ...[5, 7, 9].map((s) => ({ kind: 'blur' as const, issue: 'blurry', make: async (o: () => Sharp) => buf(o().blur(s)) })),
    ...[0.15, 0.2].map((rx) => ({ kind: 'glare' as const, issue: 'glare', make: glare(rx) })),
    ...[0.3, 0.4, 0.5].map((k) => ({ kind: 'dark' as const, issue: 'too_dark', make: async (o: () => Sharp) => buf(o().linear(k, 0)) })),
    ...[7, -9, 12].map((d) => ({ kind: 'skew' as const, issue: 'skewed', make: tilt(d) })),
    ...([['left', 0.15], ['right', 0.2], ['top', 0.15], ['bottom', 0.2]] as const).map(([s, f]) => ({ kind: 'cut' as const, issue: 'cropped', make: cut(s, f) })),
    { kind: 'good', make: async (o) => o() },
    { kind: 'good', make: async (o) => buf(o().blur(1.5)) },
    { kind: 'good', make: async (o) => buf(o().linear(0.9, 0)) },
    { kind: 'good', make: async (o) => buf(o().resize({ width: 1400 })) },
    { kind: 'good', make: async (o) => buf(o().jpeg({ quality: 55 })) },
  ]

  it('flags at least 80 % of the bad pages for the right reason, and passes most good ones', async () => {
    const bad: Record<string, [number, number]> = {}
    let goodFlagged = 0, good = 0
    for (const file of DOCS) {
      const { width, height } = await sharp(path(file)).metadata()
      const [r0, g0, b0] = (await sharp(path(file)).extract({ left: 0, top: 0, width: 24, height: 24 }).stats()).channels.map((ch) => Math.round(ch.mean))
      for (const c of CASES) {
        const r = await check(await c.make(() => sharp(path(file)), width!, height!, { r: r0, g: g0, b: b0 }))
        if (c.kind === 'good') { good++; if (!r.ok) goodFlagged++; continue }
        const t = (bad[c.kind] ??= [0, 0])
        t[1]++
        if (r.issues.includes(c.issue as never)) t[0]++
      }
    }
    const hit = Object.values(bad).reduce((a, [h]) => a + h, 0), total = Object.values(bad).reduce((a, [, n]) => a + n, 0)
    console.log(`FR-DOC-03 eval: ${hit}/${total} bad pages flagged (${((100 * hit) / total).toFixed(1)} %),`,
      Object.entries(bad).map(([k, [h, n]]) => `${k} ${h}/${n}`).join(', '), `· good pages flagged ${goodFlagged}/${good}`)
    expect(total).toBe(60)
    expect(hit / total).toBeGreaterThanOrEqual(0.8)
    expect(goodFlagged / good).toBeLessThanOrEqual(0.2)
  }, 120_000)
})
