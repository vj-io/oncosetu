// Browser-only: turn a camera frame or a picked file into an upload-ready JPEG (<= 2400 px, <= 3.5 MB)
// plus its quality report (FR-DOC-03). The 3.5 MB cap keeps requests under the 4.5 MB platform body limit.
// When the page lies on a darker desk it is cut to the page (FR-ING-01, edges.ts); the full photo is kept beside it
// so staff can switch back if the cut is wrong.
import { findPage } from './edges'
import { analyse, ANALYSIS_MAX_SIDE, type QualityReport } from './quality'

export const MAX_SIDE = 2400
export const MAX_BYTES = 3.5 * 1024 * 1024

export type Rendition = { blob: Blob; url: string; width: number; height: number }
/** `alt` is the other version (the full photo while the cropped page is used, and back); `cropped` says which one is used. */
export type CapturedPage = Rendition & { id: string; quality: QualityReport; alt: Rendition | null; cropped: boolean }

const canvasOf = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })
const scaleTo = (w: number, h: number, max: number) => {
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}
const toBlob = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', q))

type Region = { x: number; y: number; w: number; h: number }

/** JPEG of `r` (source pixels), at most MAX_SIDE and MAX_BYTES. */
async function encode(source: CanvasImageSource, r: Region): Promise<Rendition> {
  let { w, h } = scaleTo(r.w, r.h, MAX_SIDE)
  const draw = () => {
    const c = canvasOf(w, h)
    c.getContext('2d')!.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, w, h)
    return c
  }
  let canvas = draw()
  let blob = await toBlob(canvas, 0.85)
  for (let q = 0.75; blob.size > MAX_BYTES; q -= 0.1) { // a noisy photo can exceed the cap: lower quality, then size
    if (q < 0.4) {
      ;({ w, h } = scaleTo(w, h, Math.max(w, h) * 0.8))
      canvas = draw()
      q = 0.75
    }
    blob = await toBlob(canvas, q)
  }
  return { blob, url: URL.createObjectURL(blob), width: w, height: h }
}

/** `source` is a decoded image or a playing <video>; `sw`/`sh` are its pixel size. */
export async function pageFromSource(source: CanvasImageSource, sw: number, sh: number): Promise<CapturedPage> {
  const small = scaleTo(sw, sh, ANALYSIS_MAX_SIDE)
  const probe = canvasOf(small.w, small.h)
  const pctx = probe.getContext('2d', { willReadFrequently: true })!
  pctx.drawImage(source, 0, 0, small.w, small.h)
  const pixels = pctx.getImageData(0, 0, small.w, small.h)
  const quality = analyse(pixels, { width: sw, height: sh }) // on the photo as taken: "cut off" means the frame cut the page
  const full = await encode(source, { x: 0, y: 0, w: sw, h: sh })
  const box = findPage(pixels)
  if (!box) return { id: crypto.randomUUID(), ...full, quality, alt: null, cropped: false }
  const k = sw / small.w
  const x = Math.round(box.x * k), y = Math.round(box.y * k)
  const page = await encode(source, { x, y, w: Math.min(sw - x, Math.round(box.w * k)), h: Math.min(sh - y, Math.round(box.h * k)) })
  return { id: crypto.randomUUID(), ...page, quality, alt: full, cropped: true }
}

export async function pageFromFile(file: File): Promise<CapturedPage> {
  const bmp = await createImageBitmap(file) // applies EXIF orientation; throws on formats the browser cannot decode
  try {
    return await pageFromSource(bmp, bmp.width, bmp.height)
  } finally {
    bmp.close()
  }
}

/** Use the other version of the page (cropped page <-> full photo). */
export const switchCrop = (p: CapturedPage): CapturedPage =>
  p.alt ? { ...p, ...p.alt, alt: { blob: p.blob, url: p.url, width: p.width, height: p.height }, cropped: !p.cropped } : p

/** Free both versions' object URLs. */
export const revokePage = (p: CapturedPage) => { URL.revokeObjectURL(p.url); if (p.alt) URL.revokeObjectURL(p.alt.url) }
