// Per-page quality check at capture (FR-DOC-03, E-DOC-07). Pure: works on an RGBA raster, so it is unit-tested in Node.
// Callers downscale to ANALYSIS_MAX_SIDE first, so the thresholds do not depend on camera resolution.
export const ANALYSIS_MAX_SIDE = 640

export type Raster = { data: ArrayLike<number>; width: number; height: number } // RGBA, like ImageData
export type QualityIssue = 'blurry' | 'glare' | 'too_dark' | 'too_small' | 'cropped'
export type QualityMetrics = {
  sharpness: number // variance of the Laplacian of the grey image
  glarePct: number // % of pixels blown out well above the paper tone
  paperLuma: number // median of the bright half: the paper tone
  edgeInkPct: number // worst border band that is not solid background: % of ink-dark pixels where the page should end
}
export type QualityReport = { ok: boolean; issues: QualityIssue[]; metrics: QualityMetrics }

export const THRESHOLDS = {
  blurBelow: 100, // sharpness (Laplacian variance at 640 px) under this: text edges are soft
  glarePct: 4, // % blown-out pixels over which the page is flagged
  glareMargin: 25, // a glare pixel is >= 250 AND this far above the paper tone (white scans are not glare)
  darkBelow: 120, // paper tone (90th percentile luma) under this: underexposed
  minShort: 700, // original pixels: shorter side
  minLong: 1000, // original pixels: longer side
  edgeInkMin: 5, // border band with this much ink (but not a solid dark band = background): text runs off the page
  edgeInkMax: 60,
} as const

const BAND = 0.02 // outer 2 % of each side

export function analyse(r: Raster, original: { width: number; height: number } = r): QualityReport {
  const { width: w, height: h, data } = r
  const n = w * h
  const grey = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) {
    const g = (299 * data[i * 4] + 587 * data[i * 4 + 1] + 114 * data[i * 4 + 2]) / 1000
    grey[i] = g
    hist[grey[i]]++
  }
  const percentile = (p: number, from = 0, total = n) => {
    const target = total * p
    let acc = 0
    for (let v = from; v < 256; v++) { acc += hist[v]; if (acc >= target) return v }
    return 255
  }
  const p90 = percentile(0.9)
  const bright = hist.slice(128).reduce((a, b) => a + b, 0)
  const paperLuma = bright ? percentile(0.5, 128, bright) : p90 // median of the bright half

  // sharpness: variance of the 4-neighbour Laplacian over interior pixels
  let sum = 0, sumSq = 0, count = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const l = grey[i - 1] + grey[i + 1] + grey[i - w] + grey[i + w] - 4 * grey[i]
      sum += l; sumSq += l * l; count++
    }
  }
  const sharpness = count ? sumSq / count - (sum / count) ** 2 : 0

  // glare: saturated pixels that stand clearly above the paper tone
  let glare = 0
  for (let i = 0; i < n; i++) if (grey[i] >= 250 && grey[i] - paperLuma >= THRESHOLDS.glareMargin) glare++
  const glarePct = (100 * glare) / n

  // cropped: ink in the border bands of a page that should end inside the frame
  const inkBelow = Math.max(0, paperLuma - 90)
  const bw = Math.max(2, Math.round(w * BAND)), bh = Math.max(2, Math.round(h * BAND))
  const band = (x0: number, x1: number, y0: number, y1: number) => {
    let ink = 0, tot = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { tot++; if (grey[y * w + x] < inkBelow) ink++ }
    return (100 * ink) / tot
  }
  // a band that is solid dark is the desk behind the page, not text running off it
  const text = [band(0, bw, 0, h), band(w - bw, w, 0, h), band(0, w, 0, bh), band(0, w, h - bh, h)].filter((b) => b <= THRESHOLDS.edgeInkMax)
  const edgeInkPct = Math.max(0, ...text)

  const issues: QualityIssue[] = []
  if (sharpness < THRESHOLDS.blurBelow) issues.push('blurry')
  if (glarePct >= THRESHOLDS.glarePct) issues.push('glare')
  if (p90 < THRESHOLDS.darkBelow) issues.push('too_dark')
  if (Math.min(original.width, original.height) < THRESHOLDS.minShort || Math.max(original.width, original.height) < THRESHOLDS.minLong) issues.push('too_small')
  if (edgeInkPct >= THRESHOLDS.edgeInkMin) issues.push('cropped')
  return { ok: issues.length === 0, issues, metrics: { sharpness, glarePct, paperLuma, edgeInkPct } }
}

export const ISSUE_TEXT: Record<QualityIssue, string> = {
  blurry: 'Blurry or out of focus. Hold steady and let the camera focus.',
  glare: 'Glare on the page. Tilt it away from the light.',
  too_dark: 'Too dark. Move to a brighter spot.',
  too_small: 'Resolution too low. Move closer or use a better camera.',
  cropped: 'Page looks cut off at an edge. Fit the whole page in the frame.',
}
