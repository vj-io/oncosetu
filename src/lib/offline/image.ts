// Browser-only: turn a camera frame or a picked file into an upload-ready JPEG (<= 2400 px, <= 3.5 MB)
// plus its quality report (FR-DOC-03). The 3.5 MB cap keeps requests under the 4.5 MB platform body limit.
import { analyse, ANALYSIS_MAX_SIDE, type QualityReport } from './quality'

export const MAX_SIDE = 2400
export const MAX_BYTES = 3.5 * 1024 * 1024

export type CapturedPage = { id: string; blob: Blob; url: string; width: number; height: number; quality: QualityReport }

const canvasOf = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })
const scaleTo = (w: number, h: number, max: number) => {
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}
const toBlob = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', q))

/** `source` is a decoded image or a playing <video>; `sw`/`sh` are its pixel size. */
export async function pageFromSource(source: CanvasImageSource, sw: number, sh: number): Promise<CapturedPage> {
  let { w, h } = scaleTo(sw, sh, MAX_SIDE)
  let canvas = canvasOf(w, h)
  canvas.getContext('2d')!.drawImage(source, 0, 0, w, h)
  let blob = await toBlob(canvas, 0.85)
  for (let q = 0.75; blob.size > MAX_BYTES; q -= 0.1) { // a noisy photo can exceed the cap: lower quality, then size
    if (q < 0.4) {
      ;({ w, h } = scaleTo(w, h, Math.max(w, h) * 0.8))
      canvas = canvasOf(w, h)
      canvas.getContext('2d')!.drawImage(source, 0, 0, w, h)
      q = 0.75
    }
    blob = await toBlob(canvas, q)
  }
  const small = scaleTo(sw, sh, ANALYSIS_MAX_SIDE)
  const probe = canvasOf(small.w, small.h)
  const pctx = probe.getContext('2d', { willReadFrequently: true })!
  pctx.drawImage(source, 0, 0, small.w, small.h)
  const quality = analyse(pctx.getImageData(0, 0, small.w, small.h), { width: sw, height: sh })
  return { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), width: w, height: h, quality }
}

export async function pageFromFile(file: File): Promise<CapturedPage> {
  const bmp = await createImageBitmap(file) // applies EXIF orientation; throws on formats the browser cannot decode
  try {
    return await pageFromSource(bmp, bmp.width, bmp.height)
  } finally {
    bmp.close()
  }
}
