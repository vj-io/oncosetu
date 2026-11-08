// Document edge detection for desk capture (FR-ING-01). Pure, on the same downscaled RGBA raster as the quality check.
// A page lies on a darker desk: split grey levels into paper and background (Otsu), then the page box runs from the first to
// the last row (and column) that is mostly paper. It returns null, so the photo stays as taken, when there is nothing to cut:
// the page already fills the frame, the "page" is a small bright spot, or the surround is not clearly darker than the paper.
import type { Raster } from './quality'

export type Box = { x: number; y: number; w: number; h: number }

export const EDGE = {
  rowShare: 0.5, // a row (column) belongs to the page when at least this share of it is paper
  minArea: 0.2, // a box under 20 % of the frame is not the page
  maxArea: 0.92, // over 92 %: the page fills the frame, nothing worth cutting
  minContrast: 40, // paper must be at least this much brighter (luma) than the desk around it
  pad: 0.01, // keep 1 % of the frame around the box so the paper edge itself is never cut
} as const

function otsu(hist: Uint32Array, n: number): number {
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * hist[v]
  let sumB = 0, wB = 0, best = 0, t = 127
  for (let v = 0; v < 256; v++) {
    wB += hist[v]
    if (!wB) continue
    const wF = n - wB
    if (!wF) break
    sumB += v * hist[v]
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2
    if (between > best) { best = between; t = v }
  }
  return t
}

export function findPage(r: Raster): Box | null {
  const { width: w, height: h, data } = r
  const n = w * h
  const grey = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) {
    grey[i] = (299 * data[i * 4] + 587 * data[i * 4 + 1] + 114 * data[i * 4 + 2]) / 1000
    hist[grey[i]]++
  }
  const t = otsu(hist, n)
  const rows = new Uint32Array(h), cols = new Uint32Array(w)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grey[y * w + x] > t) { rows[y]++; cols[x]++ }
  const span = (counts: Uint32Array, len: number) => {
    let a = -1, b = -1
    for (let i = 0; i < counts.length; i++) if (counts[i] >= len * EDGE.rowShare) { if (a < 0) a = i; b = i }
    return [a, b] as const
  }
  const [y0, y1] = span(rows, w), [x0, x1] = span(cols, h)
  if (y0 < 0 || x0 < 0) return null
  const area = ((x1 - x0 + 1) * (y1 - y0 + 1)) / n
  if (area < EDGE.minArea || area > EDGE.maxArea) return null

  let inside = 0, inN = 0, outside = 0, outN = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y >= y0 && y <= y1 && x >= x0 && x <= x1) { if (grey[y * w + x] > t) { inside += grey[y * w + x]; inN++ } }
      else { outside += grey[y * w + x]; outN++ }
    }
  }
  if (!inN || !outN || inside / inN - outside / outN < EDGE.minContrast) return null

  const px = Math.round(w * EDGE.pad), py = Math.round(h * EDGE.pad)
  const x = Math.max(0, x0 - px), y = Math.max(0, y0 - py)
  return { x, y, w: Math.min(w, x1 + 1 + px) - x, h: Math.min(h, y1 + 1 + py) - y }
}
