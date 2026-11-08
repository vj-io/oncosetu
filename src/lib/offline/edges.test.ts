// Edge detection (FR-ING-01): demo pages photographed on a dark desk are found; a page that fills the frame is left alone.
// The demo renders already show a strip of desk, so each test starts from the paper alone (the central 86 %).
import { join } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { describe, expect, it } from 'vitest'
import { findPage } from './edges'
import { ANALYSIS_MAX_SIDE, type Raster } from './quality'

const DOCS = ['hero__03-ct-thorax-abdomen.jpg', 'hero__05-prescription-handwritten.jpg', 'hero__06-cbc-hindi.jpg', 'returning__04-lab-cbc-lft.jpg']
const path = (f: string) => join(process.cwd(), 'public', 'demo-docs', f)

async function raster(img: Sharp): Promise<Raster> {
  const { data, info } = await img.resize({ width: ANALYSIS_MAX_SIDE, height: ANALYSIS_MAX_SIDE, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

async function paper(file: string) {
  const m = await sharp(path(file)).metadata()
  const [W, H] = [Math.round(m.width! * 0.86), Math.round(m.height! * 0.86)]
  const buf = await sharp(path(file)).extract({ left: Math.round(m.width! * 0.07), top: Math.round(m.height! * 0.07), width: W, height: H }).toBuffer()
  return { buf, W, H }
}

/** The page on a dark desk: `m` = desk margin as a share of the page size on each side. Returns the page's true box (fractions). */
async function onDesk(file: string, m: { l: number; r: number; t: number; b: number }, desk = '#3a332c') {
  const { buf, W, H } = await paper(file)
  const ext = { left: Math.round(W * m.l), right: Math.round(W * m.r), top: Math.round(H * m.t), bottom: Math.round(H * m.b) }
  const img = sharp(await sharp(buf).extend({ ...ext, background: desk }).toBuffer())
  const fw = W + ext.left + ext.right, fh = H + ext.top + ext.bottom
  return { img, truth: { x: ext.left / fw, y: ext.top / fh, w: W / fw, h: H / fh } }
}

describe.each(DOCS)('page edges of %s', (file) => {
  it('finds the page on a dark desk and keeps all of it', async () => {
    const { img, truth } = await onDesk(file, { l: 0.18, r: 0.1, t: 0.08, b: 0.14 })
    const r = await raster(img)
    const box = findPage(r)!
    expect(box).not.toBeNull()
    const f = { x: box.x / r.width, y: box.y / r.height, w: box.w / r.width, h: box.h / r.height }
    // the whole page is inside the box (never cut), with little desk left over
    expect(f.x).toBeLessThanOrEqual(truth.x + 0.005)
    expect(f.y).toBeLessThanOrEqual(truth.y + 0.005)
    expect(f.x + f.w).toBeGreaterThanOrEqual(truth.x + truth.w - 0.005)
    expect(f.y + f.h).toBeGreaterThanOrEqual(truth.y + truth.h - 0.005)
    expect(f.w * f.h).toBeLessThan(truth.w * truth.h * 1.12)
  })

  it('leaves a page that fills the frame as it is', async () => {
    expect(findPage(await raster(sharp((await paper(file)).buf)))).toBeNull()
  })
})

describe('synthetic frames', () => {
  const frame = (w: number, h: number, px: (x: number, y: number) => number): Raster => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = px(x, y); data.set([v, v, v, 255], (y * w + x) * 4) }
    return { data, width: w, height: h }
  }
  const inPage = (x: number, y: number) => x >= 100 && x < 500 && y >= 60 && y < 440

  it('keeps a dark letterhead band inside the page', async () => {
    const r = frame(640, 480, (x, y) => (!inPage(x, y) ? 45 : y >= 80 && y < 130 ? 30 : (y % 24 < 4 && x % 50 < 35) ? 40 : 225))
    const b = findPage(r)!
    expect(b.y).toBeLessThanOrEqual(60)
    expect(b.y + b.h).toBeGreaterThanOrEqual(440)
  })
  it('does not crop a grey frame, a small bright spot, or a page on a desk just as bright', () => {
    expect(findPage(frame(640, 480, () => 128))).toBeNull()
    expect(findPage(frame(640, 480, (x, y) => (x > 300 && x < 360 && y > 200 && y < 260 ? 240 : 50)))).toBeNull()
    expect(findPage(frame(640, 480, (x, y) => (inPage(x, y) ? 235 : 215)))).toBeNull()
  })
})
