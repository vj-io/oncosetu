// Page text for the pipeline (FR-DOC-01/02/05/06/07, E-DOC-04/08/09/16). Pure over bytes: no DB, no network
// except tesseract's one-time traineddata download (cached under the OS temp dir, which is /tmp on Vercel).
//   PDF  → unpdf text layer per page; invisible text (white fill, render mode 3/7, < 2 pt) is removed from the
//          extraction text and returned separately; pages without a text layer are OCR'd from their embedded image.
//   image → sharp re-encode (EXIF rotate, metadata stripped, ≤ 2400 px JPEG) → tesseract eng+hin; a page without a
//          confidently read Devanagari word is read again with eng alone.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createWorker, type Worker } from 'tesseract.js'
import { extractImages, getDocumentProxy, getResolvedPDFJS } from 'unpdf'
import type { OcrWord } from '@/db/schema'
import { unzipSync } from 'fflate'

export const OCR_LOW_CONFIDENCE = 0.8
export const TEXT_PROCESSOR = { name: 'unpdf', version: '2.1' } as const
export const OCR_PROCESSOR = { name: 'tesseract.js', version: '7.0 eng+hin, eng re-read' } as const
/** What made a stored page image (document_files.processor / processor_version on page_image rows, FR-DOC-08). */
export const IMAGE_PROCESSOR = { name: 'sharp', version: `${sharp.versions.sharp ?? sharp.versions.vips} jpeg q85, long side <= 2400 px` } as const
const MAX_SIDE = 2400

export type Handwriting = {
  handwritten: boolean
  /** Lines (≥ 2 words) whose mean word confidence is < 0.75, as a share of all such lines. */
  lowLineShare: number
  lines: number
  /** Share of dark pixels that are ballpoint-blue (handwritten prescriptions in India are mostly blue ink). */
  blueInkShare: number
}

export type PageRead = {
  pageNo: number
  /** Text used for extraction (hidden text removed). */
  text: string
  /** OCR words with char offsets into `text` (null for text-layer pages). */
  words: OcrWord[] | null
  /** Mean OCR word confidence 0..1 (null for text-layer pages). */
  ocrConfidence: number | null
  lowConfidence: boolean
  source: 'text_layer' | 'ocr'
  handwriting: Handwriting | null
  /** Invisible text removed from this page (kept for staff review; never extracted). */
  hidden: string | null
  /** Re-encoded page image (JPEG) for images and scanned PDF pages. */
  image: Buffer | null
  processor: string
  processorVersion: string
}

export type ReadResult =
  | { kind: 'pages'; pages: PageRead[] }
  | { kind: 'needs_password'; incorrect: boolean }
  | { kind: 'unreadable'; reason: string }

// ---------- OCR ----------

export type OcrLangs = 'eng+hin' | 'eng'
const g = globalThis as unknown as { __oncosetuOcr?: Partial<Record<OcrLangs, Promise<Worker>>> }

function ocrWorker(langs: OcrLangs): Promise<Worker> {
  const workers = (g.__oncosetuOcr ??= {})
  if (!workers[langs]) {
    const cachePath = join(tmpdir(), 'oncosetu-tessdata')
    mkdirSync(cachePath, { recursive: true })
    workers[langs] = createWorker(langs.split('+'), 1, { cachePath }).catch((e) => {
      delete workers[langs]
      throw e
    })
  }
  return workers[langs]
}

/** Terminates the shared OCR workers (scripts/tests; the server keeps them warm). */
export async function closeOcr(): Promise<void> {
  const workers = Object.values(g.__oncosetuOcr ?? {})
  g.__oncosetuOcr = undefined
  for (const w of workers) await (await w).terminate()
}

type OcrLine = { text: string; conf: number[] }
export type OcrResult = { text: string; words: OcrWord[]; lines: OcrLine[]; mean: number | null }

/**
 * FR-DOC-02: page OCR behind one interface, so a cloud document AI can replace tesseract without touching the pipeline
 * (docs/ADR/ADR-016-provider-interfaces.md). `recognize` takes one page image (JPEG/PNG, ≤ 2400 px) and returns the text
 * built line by line, every word with its box and char offsets into `text`, word confidences per line (0..1) and the
 * mean word confidence. The language re-read and handwriting policy in ocrPage stay provider-independent.
 */
export interface OcrProvider {
  readonly name: string
  readonly version: string
  recognize(image: Buffer, langs: OcrLangs): Promise<OcrResult>
}

/** OCR one JPEG/PNG → text built line by line, with exact char offsets for every word. */
export async function ocrImage(image: Buffer, langs: OcrLangs = 'eng+hin'): Promise<OcrResult> {
  const worker = await ocrWorker(langs)
  const { data } = await worker.recognize(image, {}, { blocks: true, text: false })
  let text = ''
  const words: OcrWord[] = []
  const lines: OcrLine[] = []
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const ws = line.words.filter((w) => w.text.trim())
        if (!ws.length) continue
        if (text) text += '\n'
        // A wide horizontal gap is a column break (form layouts): keep it as a tab so labels do not run together.
        const h = [...ws].map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b)[ws.length >> 1]
        ws.forEach((w, i) => {
          const gap = i > 0 && w.bbox.x0 - ws[i - 1].bbox.x1 > 1.5 * h
          // Hindi OCR reads a label colon before a column gap as visarga ("नामः"): same length, so offsets hold.
          if (gap && text.endsWith('ः')) {
            text = text.slice(0, -1) + ':'
            words[words.length - 1].t = words[words.length - 1].t.slice(0, -1) + ':'
          }
          if (i) text += gap ? '\t' : ' '
          const s = text.length
          text += w.text
          words.push({ t: w.text, c: Math.round(w.confidence) / 100, s, e: text.length, b: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] })
        })
        lines.push({ text: ws.map((w) => w.text).join(' '), conf: ws.map((w) => w.confidence / 100) })
      }
    }
  }
  const mean = words.length ? words.reduce((a, w) => a + w.c, 0) / words.length : null
  return { text, words, lines, mean }
}

export const tesseractOcr: OcrProvider = { name: OCR_PROCESSOR.name, version: OCR_PROCESSOR.version, recognize: ocrImage }

const DEVANAGARI = /\p{Script=Devanagari}/u

/**
 * Handwriting classifier (FR-DOC-07), calibrated on the demo set (re-encoded ≤ 2400 px): the handwritten prescription
 * has ~0.4 of its lines below 0.75 mean word confidence plus blue ink; printed English and Hindi reports stay ≤ 0.25.
 * Between 0.25 and 0.35 the page is held as handwritten when either the ink is ballpoint blue or the page's mean word
 * confidence is below OCR_LOW_CONFIDENCE: a printed page wrongly held costs a person one tag, a handwritten page wrongly
 * extracted puts misread drugs and dates in front of a verifier (the held-out set's black-ink prescription, 0.31 / 0.79).
 */
// ponytail: heuristic on OCR confidence + ink colour; swap for a trained page classifier (or the LLM) when one exists.
export function classifyHandwriting(lines: OcrLine[], blueInkShare: number): Handwriting {
  const multi = lines.filter((l) => l.conf.length >= 2)
  const low = multi.filter((l) => l.conf.reduce((a, b) => a + b, 0) / l.conf.length < 0.75).length
  const lowLineShare = multi.length ? low / multi.length : 0
  const confs = lines.flatMap((l) => l.conf)
  const meanConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 1
  const handwritten = multi.length >= 8 && (lowLineShare >= 0.35 || (lowLineShare >= 0.25 && (blueInkShare >= 0.01 || meanConf < OCR_LOW_CONFIDENCE)))
  return { handwritten, lowLineShare: round3(lowLineShare), lines: multi.length, blueInkShare: round3(blueInkShare) }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

async function blueInk(jpeg: Buffer): Promise<number> {
  const { data, info } = await sharp(jpeg).resize({ width: 600 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let ink = 0, blue = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], gr = data[i + 1], b = data[i + 2]
    if (0.299 * r + 0.587 * gr + 0.114 * b < 140) {
      ink++
      if (b > r + 50 && b > gr + 30) blue++
    }
  }
  return ink ? blue / ink : 0
}

/** HEIC/HEIF that sharp's build cannot decode (no HEVC) is converted to JPEG first. */
async function heicToJpeg(bytes: Uint8Array): Promise<Buffer> {
  const { default: convert } = await import('heic-convert')
  return Buffer.from(new Uint8Array(await convert({ buffer: bytes, format: 'JPEG', quality: 0.9 })))
}

/** EXIF-rotate, strip metadata, cap the long side at 2400 px, JPEG. `page` picks a page of a multi-page TIFF. */
export async function normaliseImage(bytes: Uint8Array, page = 0, heic = false): Promise<Buffer> {
  const run = (src: Uint8Array) => sharp(src, page ? { page } : {}).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 }).toBuffer()
  try {
    return await run(bytes)
  } catch (e) {
    if (!heic) throw e
    return run(await heicToJpeg(bytes))
  }
}

/** Text of a Word document: paragraphs, tabs and line breaks kept, everything else dropped. */
export function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })
  const xml = Buffer.from(files['word/document.xml'] ?? new Uint8Array()).toString('utf8')
  return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim()
}

const typedPage = (text: string, processor: string): PageRead => ({
  pageNo: 1, text, words: null, ocrConfidence: null, lowConfidence: false, source: 'text_layer', handwriting: null, hidden: null, image: null,
  processor, processorVersion: '1',
})

async function ocrPage(pageNo: number, image: Buffer, provider: OcrProvider = tesseractOcr): Promise<PageRead> {
  const [first, ink] = await Promise.all([provider.recognize(image, 'eng+hin'), blueInk(image)])
  const handwriting = classifyHandwriting(first.lines, ink) // calibrated on the eng+hin pass
  // The Hindi model reads noise on English pages as Devanagari and misreads Latin letters. A page without one confidently
  // read Devanagari word (≥ 0.8) is read again with eng alone: CER 9.4% → 7.9% on the eval image pages (data/eval). On those
  // pages, English ones had no such word and Hindi or mixed ones had ≥ 3 — a Devanagari name in an English header counts.
  // Handwritten pages are never extracted, so they keep the first pass.
  const hindi = first.words.some((w) => w.c >= 0.8 && DEVANAGARI.test(w.t))
  const ocr = !handwriting.handwritten && !hindi ? await provider.recognize(image, 'eng') : first
  return {
    pageNo, text: ocr.text, words: ocr.words, ocrConfidence: ocr.mean === null ? null : round3(ocr.mean),
    lowConfidence: ocr.mean !== null && ocr.mean < OCR_LOW_CONFIDENCE, source: 'ocr', handwriting, hidden: null, image,
    processor: provider.name, processorVersion: provider.version,
  }
}

// ---------- PDF ----------

type TextItem = { str?: string; transform?: number[]; width?: number; hasEOL?: boolean }
type Glyph = number | { unicode?: string } | null

/** Strings drawn invisibly on a page: text render mode 3/7, or near-white fill (white-on-white). */
async function invisibleStrings(page: { getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }> }): Promise<string[]> {
  const { OPS } = (await getResolvedPDFJS()) as unknown as { OPS: Record<string, number> }
  const ops = await page.getOperatorList()
  const out: string[] = []
  let state = { fill: '#000000', mode: 0 }
  const stack: (typeof state)[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    if (fn === OPS.save) stack.push({ ...state })
    else if (fn === OPS.restore) state = stack.pop() ?? { fill: '#000000', mode: 0 }
    else if (fn === OPS.setFillRGBColor && typeof args?.[0] === 'string') state.fill = args[0]
    else if (fn === OPS.setTextRenderingMode) state.mode = Number(args?.[0] ?? 0)
    else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      const white = /^#(?:f[0-9a-f]){3}$/i.test(state.fill)
      if (white || state.mode === 3 || state.mode === 7) {
        const s = ((args?.[0] as Glyph[]) ?? []).map((x) => (x && typeof x === 'object' ? x.unicode ?? '' : '')).join('').trim()
        if (s) out.push(s)
      }
    }
  }
  return out
}

function isPasswordError(e: unknown): e is { name: string; code?: number } {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'PasswordException'
}

async function readPdf(bytes: Uint8Array, password: string | undefined, ocr: OcrProvider): Promise<ReadResult> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    pdf = await getDocumentProxy(bytes.slice(), password ? { password } : {})
  } catch (e) {
    if (isPasswordError(e)) return { kind: 'needs_password', incorrect: e.code === 2 }
    return { kind: 'unreadable', reason: 'pdf_parse_failed' }
  }
  try {
    const pages: PageRead[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const [content, hiddenStrs] = await Promise.all([page.getTextContent(), invisibleStrings(page as never)])
      let text = ''
      let hidden = ''
      let lastEnd: { x: number; y: number } | null = null
      for (const it of content.items as TextItem[]) {
        if (it.str == null) continue
        const t = it.transform ?? [1, 0, 0, 1, 0, 0]
        const size = Math.hypot(t[2], t[3])
        const s = it.str.trim()
        const invisible = !!s && ((size > 0 && size < 2) || hiddenStrs.some((h) => h === s || (s.length >= 12 && h.includes(s))))
        if (invisible) {
          hidden += it.str + (it.hasEOL ? '\n' : ' ')
          continue
        }
        // Same baseline, wide gap → column break: a tab keeps "Name: X   UHID: Y" as two fields (like pdftotext -layout).
        if (s && lastEnd && !text.endsWith('\n') && Math.abs(t[5] - lastEnd.y) < 1 && t[4] - lastEnd.x > 1.5 * size) text += '\t'
        text += it.str + (it.hasEOL ? '\n' : '')
        if (s) lastEnd = { x: t[4] + (it.width ?? 0), y: t[5] }
        if (it.hasEOL) lastEnd = null
      }
      if (text.replace(/\s/g, '').length >= 20) {
        pages.push({
          pageNo: n, text, words: null, ocrConfidence: null, lowConfidence: false, source: 'text_layer', handwriting: null,
          hidden: hidden.trim() || null, image: null, processor: TEXT_PROCESSOR.name, processorVersion: TEXT_PROCESSOR.version,
        })
        continue
      }
      // No usable text layer: OCR the largest embedded image (scanned page).
      const imgs = await extractImages(pdf, n).catch(() => [])
      const big = imgs.sort((a, b) => b.width * b.height - a.width * a.height)[0]
      if (!big) {
        pages.push({
          pageNo: n, text: '', words: null, ocrConfidence: null, lowConfidence: false, source: 'text_layer', handwriting: null,
          hidden: hidden.trim() || null, image: null, processor: TEXT_PROCESSOR.name, processorVersion: TEXT_PROCESSOR.version,
        })
        continue
      }
      const jpeg = await sharp(Buffer.from(big.data), { raw: { width: big.width, height: big.height, channels: 4 } })
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
      pages.push({ ...(await ocrPage(n, jpeg, ocr)), hidden: hidden.trim() || null })
    }
    return { kind: 'pages', pages }
  } finally {
    await pdf.cleanup().catch(() => {})
  }
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_TIFF_PAGES = 20

/**
 * Reads every page of a sniffed file (mime from sniffFile). `password` is used once and never stored (FR-ING-07).
 * `ocr` reads scanned pages and photos (FR-DOC-02, ADR-016); tesseract unless a caller passes another provider.
 */
export async function readPages(bytes: Uint8Array, mime: string, password?: string, ocr: OcrProvider = tesseractOcr): Promise<ReadResult> {
  if (mime === 'application/pdf') return readPdf(bytes, password, ocr)
  if (mime === 'text/plain') return { kind: 'pages', pages: [typedPage(Buffer.from(bytes).toString('utf8'), 'plain-text')] }
  if (mime === DOCX) {
    try {
      const t = docxText(bytes)
      return t ? { kind: 'pages', pages: [typedPage(t, 'docx-text')] } : { kind: 'unreadable', reason: 'docx_empty' }
    } catch {
      return { kind: 'unreadable', reason: 'docx_unreadable' }
    }
  }
  const heic = mime === 'image/heic'
  try {
    const count = mime === 'image/tiff' ? Math.min((await sharp(bytes).metadata()).pages ?? 1, MAX_TIFF_PAGES) : 1
    const pages: PageRead[] = []
    for (let i = 0; i < count; i++) pages.push(await ocrPage(i + 1, await normaliseImage(bytes, i, heic), ocr))
    return { kind: 'pages', pages }
  } catch {
    return { kind: 'unreadable', reason: heic ? 'heic_decode_unsupported' : 'image_decode_failed' }
  }
}

/** Share of letters that are Devanagari, and whether an unsupported script dominates (FR-DOC-05). */
export function detectLanguage(text: string): { language: 'en' | 'hi' | 'mixed' | 'unknown'; devanagariShare: number; unsupported: boolean } {
  let latin = 0, deva = 0, other = 0
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue
    if (/\p{Script=Latin}/u.test(ch)) latin++
    else if (DEVANAGARI.test(ch)) deva++
    else other++
  }
  const total = latin + deva + other
  if (!total) return { language: 'unknown', devanagariShare: 0, unsupported: false }
  const share = deva / total
  const unsupported = other / total > 0.3
  const language = share >= 0.6 ? 'hi' : share >= 0.1 ? 'mixed' : 'en'
  return { language, devanagariShare: round3(share), unsupported }
}
