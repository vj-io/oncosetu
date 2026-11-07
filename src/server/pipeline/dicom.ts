// DICOM: header facts and a viewable preview, never findings. We read who/what/when from the header and draw the pixels
// as a picture; we do not interpret the picture. Pure over bytes.
import dicomParser, { type DataSet } from 'dicom-parser'
import sharp from 'sharp'

export type DicomMeta = {
  modality: string | null
  /** Plain words for the modality, e.g. "PET-CT", "MRI", "Mammogram". */
  modalityLabel: string
  studyDate: string | null
  bodyPart: string | null
  institution: string | null
  studyDescription: string | null
  patientName: string | null
  patientId: string | null
  patientSex: string | null
  patientAge: string | null
  patientDob: string | null
  studyUid: string | null
  seriesUid: string | null
  sopClass: string | null
  instanceNumber: number | null
  frames: number
  rows: number | null
  cols: number | null
  transferSyntax: string | null
  synthetic: boolean
}

const MODALITY_WORDS: Record<string, string> = {
  CT: 'CT scan', MR: 'MRI', PT: 'PET scan', CR: 'X-ray', DX: 'X-ray', MG: 'Mammogram', US: 'Ultrasound', NM: 'Bone scan / nuclear scan',
  RF: 'Fluoroscopy', XA: 'Fluoroscopy / angiography', ECG: 'ECG', SEG: 'Radiotherapy segmentation', RTSTRUCT: 'Radiotherapy structure set',
  RTPLAN: 'Radiotherapy plan', RTDOSE: 'Radiotherapy dose', RTIMAGE: 'Radiotherapy image', OT: 'Image', SC: 'Image', PX: 'Dental X-ray',
}
const SOP_WORDS: [string, string, string][] = [
  ['1.2.840.10008.5.1.4.1.1.481.3', 'RTSTRUCT', 'Radiotherapy structure set'],
  ['1.2.840.10008.5.1.4.1.1.481.5', 'RTPLAN', 'Radiotherapy plan'],
  ['1.2.840.10008.5.1.4.1.1.481.2', 'RTDOSE', 'Radiotherapy dose'],
  ['1.2.840.10008.5.1.4.1.1.481.1', 'RTIMAGE', 'Radiotherapy image'],
  ['1.2.840.10008.5.1.4.1.1.66.4', 'SEG', 'Radiotherapy segmentation'],
  ['1.2.840.10008.5.1.4.1.1.9.1', 'ECG', 'ECG'], // 12-lead, general and ambulatory ECG waveform storage (.9.1.x)
  ['1.2.840.10008.5.1.4.1.1.128', 'PT', 'PET scan'],
]

export function modalityWord(modality: string | null, sopClass: string | null = null): string {
  const bySop = sopClass ? SOP_WORDS.find(([u]) => sopClass.startsWith(u)) : undefined
  if (bySop && (!modality || !MODALITY_WORDS[modality] || ['OT', 'SC'].includes(modality))) return bySop[2]
  return (modality && MODALITY_WORDS[modality]) || (modality ? `Imaging (${modality})` : 'Imaging file')
}

/** A study with both PT and CT in it is a PET-CT. */
export function studyLabel(modalities: string[]): string {
  const m = new Set(modalities)
  if (m.has('PT') && m.has('CT')) return 'PET-CT'
  if (m.has('NM') && m.has('CT')) return 'SPECT-CT'
  const first = [...m].find((x) => MODALITY_WORDS[x] && !['SEG'].includes(x)) ?? [...m][0] ?? null
  return modalityWord(first ?? null)
}

const str = (ds: DataSet, tag: string) => { const v = ds.string(tag); return v === undefined || v === '' ? null : v.trim() }

/** DICOM `YYYYMMDD` to ISO. */
export function dicomDate(v: string | null): string | null {
  return v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null
}

/** `LAST^FIRST^MIDDLE` to "First Middle Last" as written in the header. */
export function dicomName(v: string | null): string | null {
  if (!v) return null
  const [last, first, middle] = v.split('^').map((x) => x.trim())
  return [first, middle, last].filter(Boolean).join(' ') || null
}

/** Header age `052Y` / `006M` to "52 Y" (the form the identity check reads). */
export function dicomAge(v: string | null): string | null {
  const m = v?.match(/^(\d{1,3})([DWMY])$/)
  return m ? `${Number(m[1])} ${m[2]}` : null
}

export function parseDicomHeader(bytes: Uint8Array): { ds: DataSet; meta: DicomMeta } {
  const ds = dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' })
  const sop = str(ds, 'x00080016')
  const modality = str(ds, 'x00080060')
  const desc = str(ds, 'x00081030')
  const frames = Math.max(1, parseInt(str(ds, 'x00280008') ?? '1', 10) || 1)
  const meta: DicomMeta = {
    modality, modalityLabel: modalityWord(modality, sop), studyDate: dicomDate(str(ds, 'x00080020')), bodyPart: str(ds, 'x00180015'),
    institution: str(ds, 'x00080080'), studyDescription: desc, patientName: dicomName(str(ds, 'x00100010')), patientId: str(ds, 'x00100020'),
    patientSex: str(ds, 'x00100040'), patientAge: dicomAge(str(ds, 'x00101010')), patientDob: dicomDate(str(ds, 'x00100030')), studyUid: str(ds, 'x0020000d'), seriesUid: str(ds, 'x0020000e'),
    sopClass: sop, instanceNumber: ds.intString('x00200013') ?? null, frames, rows: ds.uint16('x00280010') ?? null, cols: ds.uint16('x00280011') ?? null,
    transferSyntax: str(ds, 'x00020010'), synthetic: /synthetic/i.test(`${desc ?? ''} ${str(ds, 'x00100010') ?? ''} ${str(ds, 'x00080080') ?? ''}`),
  }
  return { ds, meta }
}

export function readDicomMeta(bytes: Uint8Array): DicomMeta | null {
  try { return parseDicomHeader(bytes).meta } catch { return null }
}

// ---------- preview ----------

export type Preview = { ok: true; png: Buffer; frames: number; frame: number; windowed: boolean } | { ok: false; reason: 'no_pixels' | 'compression' | 'parse_failed'; note: string }
const NOT_AVAILABLE = 'Preview not available for this compression — file stored'

const RAW = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1'])
const JPEG_BASELINE = new Set(['1.2.840.10008.1.2.4.50', '1.2.840.10008.1.2.4.51'])
const RLE = '1.2.840.10008.1.2.5'

/** PackBits-style RLE used by DICOM, one segment at a time. */
function rleSegment(src: Uint8Array, start: number, end: number, out: Uint8Array, outStart: number, stride: number) {
  let i = start, o = outStart
  while (i < end && o < out.length) {
    const n = (src[i++] << 24) >> 24
    if (n >= 0) { for (let k = 0; k <= n && o < out.length; k++, o += stride) out[o] = src[i++] }
    else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n && o < out.length; k++, o += stride) out[o] = v }
  }
}

function decodeRle(frame: Uint8Array, pixels: number, bytesPerSample: number, samples: number): Uint8Array {
  const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const segs = dv.getUint32(0, true)
  const offs = Array.from({ length: segs }, (_, i) => dv.getUint32(4 + i * 4, true))
  const out = new Uint8Array(pixels * bytesPerSample * samples)
  const stride = bytesPerSample * samples
  offs.forEach((off, s) => {
    const end = s + 1 < segs ? offs[s + 1] : frame.length
    const sample = Math.floor(s / bytesPerSample), byteInSample = s % bytesPerSample
    // segments run most-significant byte first; the output is little endian
    rleSegment(frame, off, end, out, sample * bytesPerSample + (bytesPerSample - 1 - byteInSample), stride)
  })
  return out
}

function firstNumber(v: string | null): number | null { const n = v ? parseFloat(v.split('\\')[0]) : NaN; return Number.isFinite(n) ? n : null }

/** Renders one frame as a PNG (window/level from the header when present). Never throws: unsupported files return a plain note. */
export async function renderDicomFrame(bytes: Uint8Array, frameIndex?: number): Promise<Preview> {
  let ds: DataSet
  try { ds = dicomParser.parseDicom(bytes) } catch { return { ok: false, reason: 'parse_failed', note: 'Preview not available — file stored' } }
  const el = ds.elements.x7fe00010
  const rows = ds.uint16('x00280010'), cols = ds.uint16('x00280011')
  if (!el || !rows || !cols) return { ok: false, reason: 'no_pixels', note: 'No picture inside this file — file stored' }
  const ts = str(ds, 'x00020010') ?? '1.2.840.10008.1.2'
  const frames = Math.max(1, parseInt(str(ds, 'x00280008') ?? '1', 10) || 1)
  const frame = Math.min(Math.max(frameIndex ?? Math.floor(frames / 2), 0), frames - 1) // default: the middle slice
  const samples = ds.uint16('x00280002') ?? 1
  const alloc = ds.uint16('x00280100') ?? 8
  const signed = (ds.uint16('x00280103') ?? 0) === 1
  const photometric = str(ds, 'x00280004') ?? 'MONOCHROME2'
  const bps = alloc > 8 ? 2 : 1
  const px = rows * cols
  try {
    if (JPEG_BASELINE.has(ts)) {
      const frag = el.fragments?.length === frames ? dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, frame, 1)
        : frames === 1 ? dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, 0, el.fragments?.length ?? 1)
          : dicomParser.readEncapsulatedImageFrame(ds, el, frame, el.basicOffsetTable)
      const png = await sharp(Buffer.from(frag)).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
      return { ok: true, png, frames, frame, windowed: false }
    }
    let data: Uint8Array
    if (RAW.has(ts)) {
      const frameLen = px * bps * samples
      data = new Uint8Array(ds.byteArray.buffer, ds.byteArray.byteOffset + el.dataOffset + frame * frameLen, frameLen)
      if (data.length < frameLen) return { ok: false, reason: 'parse_failed', note: 'Preview not available — file stored' }
    } else if (ts === RLE) {
      const frag = el.fragments?.length === frames ? dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, frame, 1)
        : dicomParser.readEncapsulatedImageFrame(ds, el, frame, el.basicOffsetTable)
      data = decodeRle(frag as Uint8Array, px, bps, samples)
    } else {
      return { ok: false, reason: 'compression', note: NOT_AVAILABLE } // JPEG 2000, JPEG-LS, JPEG lossless: follow-up
    }

    if (samples === 3) {
      const planar = (ds.uint16('x00280006') ?? 0) === 1
      const rgb = Buffer.alloc(px * 3)
      for (let i = 0; i < px; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = planar ? data[c * px + i] : data[i * 3 + c]
      const png = await sharp(rgb, { raw: { width: cols, height: rows, channels: 3 } }).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
      return { ok: true, png, frames, frame, windowed: false }
    }
    const slope = firstNumber(str(ds, 'x00281053')) ?? 1, intercept = firstNumber(str(ds, 'x00281052')) ?? 0
    const vals = new Float32Array(px)
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let i = 0; i < px; i++) {
      const raw = bps === 2 ? (signed ? dv.getInt16(i * 2, true) : dv.getUint16(i * 2, true)) : (signed ? dv.getInt8(i) : dv.getUint8(i))
      vals[i] = raw * slope + intercept
    }
    const wc = firstNumber(str(ds, 'x00281050')), ww = firstNumber(str(ds, 'x00281051'))
    let lo: number, hi: number, windowed = false
    if (wc !== null && ww !== null && ww > 0) { lo = wc - ww / 2; hi = wc + ww / 2; windowed = true } else {
      lo = Infinity; hi = -Infinity
      for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v }
      if (!(hi > lo)) hi = lo + 1
    }
    const g = Buffer.alloc(px)
    for (let i = 0; i < px; i++) {
      let t = (vals[i] - lo) / (hi - lo)
      t = t < 0 ? 0 : t > 1 ? 1 : t
      g[i] = Math.round((photometric === 'MONOCHROME1' ? 1 - t : t) * 255)
    }
    const png = await sharp(g, { raw: { width: cols, height: rows, channels: 1 } }).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    return { ok: true, png, frames, frame, windowed }
  } catch {
    return { ok: false, reason: 'compression', note: NOT_AVAILABLE }
  }
}
