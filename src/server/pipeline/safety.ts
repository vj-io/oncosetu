// File-safety checks run on raw upload bytes before anything is processed (FR-ING-06/08, E-DOC-01/02/05/19).
// Pure functions over bytes; no DB. sharp is used only for the perceptual hash, pdf-lib only to re-save a sanitised PDF.
import { inflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFObject } from 'pdf-lib'
import sharp from 'sharp'

import { MAX_FILE_BYTES } from '@/core/limits'
export { MAX_FILE_BYTES }

export type SniffedMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

/** Magic-byte sniff. Returns null for anything that is not PDF/JPEG/PNG/WebP/HEIC (the declared type is ignored). */
export function sniffMime(b: Uint8Array): SniffedMime | null {
  const ascii = (s: number, e: number) => String.fromCharCode(...b.subarray(s, e))
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'image/png'
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(8, 12))) return 'image/heic'
  // PDF header may follow up to 1 KB of junk (PDF 32000-1 §7.5.2 implementation note).
  const head = Buffer.from(b.subarray(0, 1024)).toString('latin1')
  if (head.indexOf('%PDF-') !== -1) return 'application/pdf'
  return null
}

// EICAR anti-malware test file (68 bytes). Split so this source file itself never contains the signature.
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

/** EICAR test-signature check. Honest label: signature check only; a full AV scan is out of scope on serverless. */
export function hasEicar(b: Uint8Array): boolean {
  return Buffer.from(b).indexOf(EICAR, 0, 'latin1') !== -1
}

/**
 * FR-ING-08: the malware scan behind one interface (docs/ADR/ADR-016-provider-interfaces.md), so a ClamAV host (or a
 * cloud scanner) can replace the signature check without touching intake. `scan` gets the raw upload bytes before any
 * other step reads them; `reason` is the code stored in the quarantine record; `label` says how thorough the scan is
 * and is shown to staff beside every quarantined file.
 */
export interface MalwareScanner {
  readonly name: string
  readonly label: string
  scan(bytes: Uint8Array): Promise<{ infected: boolean; reason: string | null }>
}

/** The default scanner: the EICAR test signature only. */
export const eicarScanner: MalwareScanner = {
  name: 'eicar-signature',
  label: 'signature check; full AV scan out of scope on serverless',
  scan: async (b) => (hasEicar(b) ? { infected: true, reason: 'eicar_signature' } : { infected: false, reason: null }),
}

// Active-content PDF names (E-DOC-05). Matched as whole names: `/JS` must not match `/JSFoo`.
const ACTIVE_NAMES = ['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia', 'AA'] as const
const NAME_RE = /\/([A-Za-z0-9#]+)/g
const MAX_INFLATE = 20 * 1024 * 1024

/** `#xx` hex escapes in PDF names (`/J#61vaScript` → `/JavaScript`). */
const decodeName = (n: string) => n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))

function namesIn(text: string, found: Set<string>) {
  for (const m of text.matchAll(NAME_RE)) {
    const name = decodeName(m[1])
    if ((ACTIVE_NAMES as readonly string[]).includes(name)) found.add(name)
  }
}

/**
 * Scans raw PDF bytes (and every Flate stream inside, so object streams cannot hide keys) for active content.
 * Returns the active names found, e.g. ['JavaScript', 'OpenAction'] — empty means clean.
 */
export function scanPdf(b: Uint8Array): string[] {
  const raw = Buffer.from(b).toString('latin1')
  const found = new Set<string>()
  namesIn(raw, found)
  let inflated = 0
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length
    const end = raw.indexOf('endstream', start)
    if (end === -1 || inflated > MAX_INFLATE) break
    try {
      const out = inflateSync(Buffer.from(raw.slice(start, end), 'latin1'), { maxOutputLength: MAX_INFLATE - inflated })
      inflated += out.length
      namesIn(out.toString('latin1'), found)
    } catch { /* not a Flate stream (image, font) — fine */ }
  }
  // /OpenAction is only active content when it runs JavaScript; that case is already caught by /JS or /JavaScript.
  if (found.has('JS') || found.has('JavaScript')) {
    if (/\/OpenAction/.test(raw)) found.add('OpenAction')
  }
  return [...found].sort()
}

// FR-ING-08: what sanitisePdf removes. Keys that run something or carry a file go wherever they appear; objects that are
// themselves active (an embedded file, an action that runs or launches something, a media or attachment annotation) are
// deleted, and every key or array entry pointing at one goes with them.
const STRIP_KEYS = new Set(['JS', 'JavaScript', 'AA', 'OpenAction', 'EmbeddedFiles', 'EF', 'AF', 'RichMediaContent', 'RichMediaSettings'])
const ACTIVE_ACTIONS = new Set(['JavaScript', 'Launch', 'ImportData', 'SubmitForm', 'RichMediaExecute', 'GoToE', 'Rendition'])
const ACTIVE_SUBTYPES = new Set(['RichMedia', 'FileAttachment', 'Screen', 'Movie', 'Sound'])
const nameAt = (d: PDFDict, key: string) => {
  const v = d.get(PDFName.of(key))
  return v instanceof PDFName ? v.decodeText() : ''
}

function isActive(o: PDFObject | undefined): boolean {
  const d = o instanceof PDFStream ? o.dict : o
  return d instanceof PDFDict && (nameAt(d, 'Type') === 'EmbeddedFile' || ACTIVE_ACTIONS.has(nameAt(d, 'S')) || ACTIVE_SUBTYPES.has(nameAt(d, 'Subtype')))
}

/**
 * Re-saves a PDF without its active content (JavaScript, auto-open and additional actions, launch actions, embedded files,
 * rich media). Returns the clean bytes only when scanPdf finds nothing left in them; null when the file cannot be parsed
 * (damaged, encrypted) or something survives, so the caller quarantines instead. Deterministic: the same input gives the
 * same output, so a re-upload still dedupes.
 */
export async function sanitisePdf(b: Uint8Array): Promise<Uint8Array | null> {
  try {
    const doc = await PDFDocument.load(b, { updateMetadata: false })
    const ctx = doc.context
    const objects = ctx.enumerateIndirectObjects()
    const activeRefs = new Set(objects.filter(([, o]) => isActive(o)).map(([ref]) => ref))
    const dead = (v: PDFObject) => (v instanceof PDFRef ? activeRefs.has(v) : isActive(v))
    const clean = (o: PDFObject) => { // direct objects only; every indirect one is visited by the loop below
      const d = o instanceof PDFStream ? o.dict : o
      if (d instanceof PDFDict) {
        for (const [k, v] of d.entries()) {
          if (STRIP_KEYS.has(k.decodeText()) || dead(v)) d.delete(k)
          else if (!(v instanceof PDFRef)) clean(v)
        }
      } else if (d instanceof PDFArray) {
        for (let i = d.size() - 1; i >= 0; i--) {
          const v = d.get(i)
          if (dead(v)) d.remove(i)
          else if (!(v instanceof PDFRef)) clean(v)
        }
      }
    }
    for (const [, o] of objects) clean(o)
    // Drop everything no longer reachable from the trailer: the active objects and what only they used (file specs, file data).
    const reachable = new Set<PDFRef>()
    const visit = (o: PDFObject | undefined) => {
      if (o instanceof PDFRef) {
        if (!reachable.has(o)) { reachable.add(o); visit(ctx.lookup(o)) }
        return
      }
      const d = o instanceof PDFStream ? o.dict : o
      if (d instanceof PDFDict) for (const [, v] of d.entries()) visit(v)
      else if (d instanceof PDFArray) for (let i = 0; i < d.size(); i++) visit(d.get(i))
    }
    visit(ctx.trailerInfo.Root)
    visit(ctx.trailerInfo.Info)
    for (const [ref] of objects) if (!reachable.has(ref)) ctx.delete(ref)
    const out = await doc.save({ useObjectStreams: false })
    return scanPdf(out).length ? null : out
  } catch {
    return null
  }
}

/** 64-bit difference hash (dHash) of an image as 16 hex chars: greyscale 9×8, compare horizontal neighbours. */
export async function dHash(image: Uint8Array): Promise<string> {
  const px = await sharp(image).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let bits = 0n
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n)
  return bits.toString(16).padStart(16, '0')
}

export function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = 0
  while (x) { n += Number(x & 1n); x >>= 1n }
  return n
}

export const NEAR_DUP_HAMMING = 6

/** Word-trigram Jaccard similarity for text-layer near-duplicates (FR-ING-06: ≥ 0.95). */
export function textSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const w = s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    const out = new Set<string>()
    for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)
    return out
  }
  const A = grams(a), B = grams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}
