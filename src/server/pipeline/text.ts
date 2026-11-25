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
import { createWorker, PSM, type Worker } from 'tesseract.js'
import { extractImages, getDocumentProxy, getResolvedPDFJS } from 'unpdf'
import type { OcrWord } from '@/db/schema'
import { findDates, parseDate } from '@/core/dates'
import { parseHeader } from '@/core/extract/header'
import { classifyDocument } from '@/core/extract/classify'
import { readHeaderTable } from './table'
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
  /** The line rule said handwritten, but the words read as a printed report (readsAsPrintedReport), so the page is read. */
  printedReport?: true
  /** The line rule said handwritten, but the header carries a printed report or collection date (hasPrintedReportHeader), so the page is read. */
  printedHeader?: true
  /** The line rule said handwritten, and a person marked the file as printed (actions.markPrinted), so the page is read. */
  printedByStaff?: true
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

/** An OCR'd page without its image (the image is cheap to rebuild); what is saved per page so a retry resumes (0026). */
export type CachedPage = Omit<PageRead, 'image'>

/**
 * Hooks for long reads. `cached`: pages an earlier attempt already OCR'd (taken as read, only their image is rebuilt).
 * `onPage` runs before a page is read (`page: null`, "Reading page 7 of 16") and again once it is read (`fresh`: it was
 * OCR'd now, not taken from `cached`), so the caller can renew its lock and save the page.
 */
export type ReadHooks = {
  /** A person marked this file as printed: no page is held as handwritten (Handwriting.printedByStaff). */
  printed?: boolean
  cached?: ReadonlyMap<number, CachedPage>
  onPage?: (info: { pageNo: number; total: number; page: PageRead | null; fresh: boolean }) => Promise<void> | void
}

export type ReadResult =
  | { kind: 'pages'; pages: PageRead[] }
  | { kind: 'needs_password'; incorrect: boolean }
  | { kind: 'unreadable'; reason: string }

// ---------- OCR ----------

export type OcrLangs = 'eng+hin' | 'eng'
/** 'eng-line': an English worker that reads its image as one line of text (header date re-reads). */
type OcrKey = OcrLangs | 'eng-line'
const g = globalThis as unknown as { __oncosetuOcr?: Partial<Record<OcrKey, Promise<Worker>>> }

function ocrWorker(key: OcrKey): Promise<Worker> {
  const workers = (g.__oncosetuOcr ??= {})
  if (!workers[key]) {
    const cachePath = join(tmpdir(), 'oncosetu-tessdata')
    mkdirSync(cachePath, { recursive: true })
    const langs = key === 'eng-line' ? ['eng'] : key.split('+')
    workers[key] = createWorker(langs, 1, { cachePath })
      .then(async (w) => (key === 'eng-line' ? (await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE }), w) : w))
      .catch((e) => {
        delete workers[key]
        throw e
      })
  }
  return workers[key]
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
  /** Optional: read a small image as one line of English (rereadHeaderDates); a provider without it skips the re-read. */
  recognizeLine?(image: Buffer): Promise<OcrResult>
}

/** OCR one JPEG/PNG → text built line by line, with exact char offsets for every word. */
export async function ocrImage(image: Buffer, langs: OcrLangs = 'eng+hin'): Promise<OcrResult> {
  return readWords(await ocrWorker(langs), image)
}

async function readWords(worker: Worker, image: Buffer): Promise<OcrResult> {
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

export const tesseractOcr: OcrProvider = {
  name: OCR_PROCESSOR.name, version: OCR_PROCESSOR.version, recognize: ocrImage,
  recognizeLine: async (image) => readWords(await ocrWorker('eng-line'), image),
}

/** A date label of a report header: "Exam Date:", "Report Date:", "Date:", or a table's label cell ("Report Date | ", "Date <TAB>"). */
const HEADER_DATE_LABEL = /(?<![\p{L}])(?:(?:Exam(?:ination)?|Report(?:ed)?|Reporting|Scan|Study|Visit|Collection|Collected|Sample|Admission|Discharge|Procedure)\s+)?(?:Date|Dt\.?)(?:\s*[:：|¦]|[ ]*\t)/giu
/** The header block, as the pipeline reads it (core.ts HEADER_LINES). */
const HEADER_LINES = 15
const ONLY_SEPARATORS = /^[\s\-–=.|¦[\]:]*$/

/**
 * A photographed header can lose its date to the page OCR ("Exam Date: 10/10/2026" read as "Exam Date: or"); the report
 * then takes a date quoted further down (an earlier study) or none. When a date label in the header block has no readable
 * date after it (in its own cell, or in the next column when its cell is blank), the strip right of the label is read again on its own: cropped from
 * the page image, 3× scale, grey, table rules painted white (whitenRules), one line of English. A valid date read at the
 * start of that strip replaces the unreadable words, and every later word's offsets move with it; nothing else changes.
 * Measured 25 Nov 2026 on a photographed MRI report: the page read "or", the strip read 10/10/2026 (as printed); and on a
 * photographed PET-CT table header: the page read the report date with its year cut off, the strip read it whole.
 */
export async function rereadHeaderDates(ocr: OcrResult, image: Buffer, provider: OcrProvider): Promise<OcrResult> {
  if (!provider.recognizeLine) return ocr
  const headerEnd = ocr.text.split('\n').slice(0, HEADER_LINES).join('\n').length
  const labels = [...ocr.text.slice(0, headerEnd).matchAll(HEADER_DATE_LABEL)].reverse() // last first: earlier offsets stay valid
  let { text, words } = ocr
  let size: { width: number; height: number } | null = null
  for (const m of labels) {
    const labelEnd = m.index + m[0].length
    const cellEnd = (from: number) => { const i = text.slice(from).search(/[\t\n]/); return i < 0 ? text.length : from + i }
    const valueEnd = cellEnd(labelEnd)
    const value = text.slice(labelEnd, valueEnd)
    // Readable: a date in the label's own cell ("Report Date: ~~ 20/02/2026"), or, when that cell is blank, in the next
    // column ("Date:<TAB>20/04/2026"). Only a value with no date at all is read again.
    const nextCell = !value.trim() && text[valueEnd] === '\t' ? text.slice(valueEnd + 1, cellEnd(valueEnd + 1)) : ''
    if ([value, nextCell].some((v) => findDates(v).some((d) => d.kind === 'absolute'))) continue
    // The strip starts right of the label's last mark (its colon, or the table rule read as "|"); its height is the
    // label's first word's (a rule's box can span the whole row).
    const inLabel = words.filter((w) => w.s < labelEnd && w.e > m.index)
    const box = inLabel.at(-1)?.b
    const first = inLabel[0]?.b
    const h = first ? first[3] - first[1] : 0
    if (!box || h <= 0) continue
    if (!size) {
      const meta = await sharp(image).metadata()
      size = { width: meta.width ?? 0, height: meta.height ?? 0 }
    }
    const left = Math.min(box[2], size.width), top = Math.max(0, box[1] - Math.round(h * 0.4))
    const width = Math.min(size.width - left, h * 14), height = Math.min(size.height - top, Math.round(h * 1.8))
    if (width < h || height < h) continue
    const { data: px, info } = await sharp(image).extract({ left, top, width, height }).resize({ height: height * 3 }).greyscale().normalise()
      .extractChannel(0).raw().toBuffer({ resolveWithObject: true })
    whitenRules(px, info.width, info.height)
    const read = await provider.recognizeLine(await sharp(px, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer())
    const d = findDates(read.text).find((x) => x.kind === 'absolute' && ONLY_SEPARATORS.test(read.text.slice(0, x.start)))
    // Only a real calendar day replaces the value: a misread such as "55 Mar 2026" is no date.
    if (!d || parseDate(d.raw).precision !== 'day') continue
    const put = ` ${d.raw}`
    const delta = put.length - value.length
    const date: OcrWord = { t: d.raw, c: Math.round((read.mean ?? 0.5) * 100) / 100, s: labelEnd + 1, e: labelEnd + 1 + d.raw.length, b: [left, top, left + width, top + height] }
    text = text.slice(0, labelEnd) + put + text.slice(valueEnd)
    words = [
      ...words.filter((w) => w.e <= labelEnd), date,
      ...words.filter((w) => w.s >= valueEnd).map((w) => ({ ...w, s: w.s + delta, e: w.e + delta })),
    ]
  }
  if (text === ocr.text) return ocr
  // `lines` stays as read: it only feeds the handwriting verdict, which is taken before this re-read.
  return { ...ocr, text, words, mean: words.length ? words.reduce((a, w) => a + w.c, 0) / words.length : null }
}

/**
 * A header strip cut from a table holds the row's rules above and below the value and the cell border beside it; read as
 * one line they garble the date (on a photographed PET-CT header, 25 Nov 2026, the strip read an impossible day of the
 * month; with the rules painted white it read the date as printed). Ink connected across a third of the strip's width,
 * or over nearly its full height, is a rule: no glyph of one line of text is that wide or that tall. Painted white in
 * place (greyscale pixels, dark < 128); returns how many rules it removed.
 */
export function whitenRules(px: Uint8Array, width: number, height: number): number {
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  let removed = 0
  for (let start = 0; start < px.length; start++) {
    if (seen[start] || px[start] >= 128) continue
    const members: number[] = []
    let x0 = width, x1 = -1, y0 = height, y1 = -1
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()!
      members.push(p)
      const x = p % width, y = (p - x) / width
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, q = yy * width + xx
          if (xx >= 0 && xx < width && yy >= 0 && yy < height && !seen[q] && px[q] < 128) { seen[q] = 1; stack.push(q) }
        }
      }
    }
    if (x1 - x0 + 1 >= width / 3 || y1 - y0 + 1 >= height * 0.9) {
      for (const p of members) px[p] = 255
      removed++
    }
  }
  return removed
}

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

/**
 * A phone photo of a printed report can have most of its lines below 0.75 confidence and so be judged handwritten. Its words
 * still read as a report: a non-prescription class scoring ≥ 9 (the strong-page bar of classify) and ≥ 55% real words. On
 * the evaluation sets' six handwritten prescriptions real words are 39–46% and no report class leads; on photographed
 * printed imaging reports judged handwritten they are 62–67% with imaging scores 9–15 (measured 25 Nov 2026).
 */
export function readsAsPrintedReport(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 40) return false
  const best = Object.entries(classifyDocument([text]).scores).filter(([k]) => !k.startsWith('prescription')).reduce((m, [, v]) => Math.max(m, v), 0)
  const real = words.filter((w) => /^[A-Za-z]{3,}[.,:;)]?$/.test(w)).length
  return best >= 9 && real / words.length >= 0.55
}

/**
 * A report's own printed header: a "Report date" / "Reported on" or "Collected" / "Sample date" label with a readable date
 * in the header block (parseHeader's reported and collection labels). A bare "Date:" does not count: prescription pads
 * print that. Phone photos of lab and pathology slips are judged handwritten on line confidence alone, and their text, date
 * included, was dropped (measured 25 Nov 2026 on a 36-page photographed folder: 6 dated report pages held).
 */
export function hasPrintedReportHeader(text: string): boolean {
  const h = parseHeader(text.split('\n').slice(0, HEADER_LINES).join('\n'))
  const d = h.reportedDate ?? h.collectionDate
  return !!d && parseDate(d.value).precision === 'day'
}

async function ocrPage(pageNo: number, image: Buffer, provider: OcrProvider = tesseractOcr, printed = false): Promise<PageRead> {
  const [first, ink] = await Promise.all([provider.recognize(image, 'eng+hin'), blueInk(image)])
  const verdict = classifyHandwriting(first.lines, ink) // calibrated on the eng+hin pass
  const handwriting: Handwriting = !verdict.handwritten ? verdict
    : printed ? { ...verdict, handwritten: false, printedByStaff: true }
    : readsAsPrintedReport(first.text) ? { ...verdict, handwritten: false, printedReport: true }
    : hasPrintedReportHeader(first.text) ? { ...verdict, handwritten: false, printedHeader: true } : verdict
  // The Hindi model reads noise on English pages as Devanagari and misreads Latin letters. A page without one confidently
  // read Devanagari word (≥ 0.8) is read again with eng alone: CER 9.4% → 7.9% on the eval image pages (data/eval). On those
  // pages, English ones had no such word and Hindi or mixed ones had ≥ 3 — a Devanagari name in an English header counts.
  // Handwritten pages are never extracted, so they keep the first pass.
  const hindi = first.words.some((w) => w.c >= 0.8 && DEVANAGARI.test(w.t))
  const read = !handwriting.handwritten && !hindi ? await provider.recognize(image, 'eng') : first
  const dated = handwriting.handwritten ? read : await rereadHeaderDates(read, image, provider)
  // The file's first page carries the header the identity check reads: a ruled header table it could not read is read cell by cell.
  const ocr = pageNo === 1 && !handwriting.handwritten ? await readHeaderTable(dated, image, provider) : dated
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

async function readPdf(bytes: Uint8Array, password: string | undefined, ocr: OcrProvider, hooks: ReadHooks): Promise<ReadResult> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    pdf = await getDocumentProxy(bytes.slice(), password ? { password } : {})
  } catch (e) {
    if (isPasswordError(e)) return { kind: 'needs_password', incorrect: e.code === 2 }
    return { kind: 'unreadable', reason: 'pdf_parse_failed' }
  }
  try {
    const pages: PageRead[] = []
    const total = pdf.numPages
    for (let n = 1; n <= total; n++) {
      await hooks.onPage?.({ pageNo: n, total, page: null, fresh: false })
      const page = await pdf.getPage(n)
      const done = async (p: PageRead, fresh: boolean) => {
        // Release the page's decoded images once it is read: kept until the end they grew memory ~30 MB a page of a scan
        // (2.5 GB by page 36, and Vercel killed the instance).
        page.cleanup()
        pages.push(p)
        await hooks.onPage?.({ pageNo: n, total, page: p, fresh })
      }
      const [content, hiddenStrs] = await Promise.all([page.getTextContent(), invisibleStrings(page as never)])
      // The page's lines as written; `end` and `y`: where the line's last visible item ends, and its baseline.
      const lines: { text: string; y: number; end: number | null }[] = [{ text: '', y: 0, end: null }]
      const [, y0, , y1] = page.view
      const headerFloor = y1 - 0.3 * (y1 - y0) // PDF y grows upwards: the top 30% of the page
      let cur = 0
      let hidden = ''
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
        // A header table whose cells of several lines are written whole, one after another ("Study Date", "Time", then the
        // value cell "03 Mar 2026", "4:05pm"): in the top 30% of the page, a line that starts on the baseline of one of the
        // last CELL_LINES lines, right of its end, continues that line when it holds only short cells, so each label sits
        // beside its value. Blocks of running text side by side (an address beside a registration number) and
        // two-column text keep their order.
        // ponytail: header grids only. Rejoining body tables and side-by-side header text by row changed six evaluation
        // documents' facts (25 Nov 2026); extend it there with the medication and pathology rules re-tuned.
        const last = lines.length - 1
        let cell = false
        if (s && t[5] >= headerFloor && cur === last && !lines[last].text.trim()) {
          for (let k = last - 1; k >= Math.max(0, last - CELL_LINES); k--) {
            const l = lines[k]
            if (l.end !== null && Math.abs(t[5] - l.y) < 1 && t[4] >= l.end - 1 && l.text.split('\t').every((c) => c.trim().length <= SHORT_CELL)) {
              cur = k
              cell = true
              break
            }
          }
        }
        const line = lines[cur]
        // Same baseline, wide gap → column break: a tab keeps "Name: X   UHID: Y" as two fields (like pdftotext -layout).
        // A cell written after its row's other cells is a column of its own whatever the gap.
        if (s && line.end !== null && Math.abs(t[5] - line.y) < 1 && (cell || t[4] - line.end > 1.5 * size)) line.text += '\t'
        line.text += it.str
        if (s) Object.assign(line, { end: t[4] + (it.width ?? 0), y: t[5] })
        if (it.hasEOL) {
          if (cur === last) lines.push({ text: '', y: 0, end: null })
          cur = lines.length - 1
        }
      }
      const text = lines.map((l) => l.text).join('\n')
      if (text.replace(/\s/g, '').length >= 20) {
        await done({
          pageNo: n, text, words: null, ocrConfidence: null, lowConfidence: false, source: 'text_layer', handwriting: null,
          hidden: hidden.trim() || null, image: null, processor: TEXT_PROCESSOR.name, processorVersion: TEXT_PROCESSOR.version,
        }, false)
        continue
      }
      // No usable text layer: OCR the largest embedded image (scanned page).
      const imgs = await extractImages(pdf, n).catch(() => [])
      const big = imgs.sort((a, b) => b.width * b.height - a.width * a.height)[0]
      if (!big) {
        await done({
          pageNo: n, text: '', words: null, ocrConfidence: null, lowConfidence: false, source: 'text_layer', handwriting: null,
          hidden: hidden.trim() || null, image: null, processor: TEXT_PROCESSOR.name, processorVersion: TEXT_PROCESSOR.version,
        }, false)
        continue
      }
      // big.data is passed as it is: a copy per page (~35 MB raw at 300 dpi) raised peak memory by about 300 MB over a long scan.
      const jpeg = await sharp(big.data, { raw: { width: big.width, height: big.height, channels: 4 } })
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
      const before = hooks.cached?.get(n)
      // A page an earlier attempt already read: its text is kept, only the image is rebuilt (a retry resumes, never restarts).
      if (before && before.source === 'ocr' && before.processor === ocr.name && before.processorVersion === ocr.version) await done({ ...before, image: jpeg }, false)
      else await done({ ...(await ocrPage(n, jpeg, ocr, hooks.printed)), hidden: hidden.trim() || null }, true)
    }
    return { kind: 'pages', pages }
  } finally {
    await pdf.cleanup().catch(() => {})
  }
}

/** How far back (in lines) a PDF line may continue an earlier one: the lines of one multi-line table cell. */
const CELL_LINES = 6
/** A header table's cell: a label, a date, a time, an age or an ID, never a line of running text. */
const SHORT_CELL = 24
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_TIFF_PAGES = 20

/**
 * Reads every page of a sniffed file (mime from sniffFile). `password` is used once and never stored (FR-ING-07).
 * `ocr` reads scanned pages and photos (FR-DOC-02, ADR-016); tesseract unless a caller passes another provider.
 */
export async function readPages(bytes: Uint8Array, mime: string, password?: string, ocr: OcrProvider = tesseractOcr, hooks: ReadHooks = {}): Promise<ReadResult> {
  if (mime === 'application/pdf') return readPdf(bytes, password, ocr, hooks)
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
  let hookError: unknown = null // a failing hook (lost lock, consent withdrawn) is not an unreadable image
  const call = async (info: Parameters<NonNullable<ReadHooks['onPage']>>[0]) => {
    try { await hooks.onPage?.(info) } catch (e) { hookError = e; throw e }
  }
  try {
    const count = mime === 'image/tiff' ? Math.min((await sharp(bytes).metadata()).pages ?? 1, MAX_TIFF_PAGES) : 1
    const pages: PageRead[] = []
    for (let i = 0; i < count; i++) {
      await call({ pageNo: i + 1, total: count, page: null, fresh: false })
      const image = await normaliseImage(bytes, i, heic)
      const before = hooks.cached?.get(i + 1)
      const reuse = before && before.source === 'ocr' && before.processor === ocr.name && before.processorVersion === ocr.version
      const page = reuse ? { ...before, image } : await ocrPage(i + 1, image, ocr, hooks.printed)
      pages.push(page)
      await call({ pageNo: i + 1, total: count, page, fresh: !reuse })
    }
    return { kind: 'pages', pages }
  } catch {
    if (hookError) throw hookError
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
