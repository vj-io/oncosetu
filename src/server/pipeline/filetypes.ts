// Content sniffing for every file type the app accepts (never the extension, never the declared type) and the plain labels
// shown on the Documents page. Pure over bytes. Rule for all of them: store, show what we safely can, never interpret.
import { unzipSync } from 'fflate'

export type FileKind =
  | 'pdf' | 'jpeg' | 'png' | 'webp' | 'heic' | 'tiff'
  | 'dicom' | 'nifti' | 'video' | 'ecg_xml' | 'ecg_scp' | 'docx' | 'text' | 'zip'

/** Document-board categories: Report (read as text), Scan (imaging, stored), ECG, Video, Photo. */
export type Category = 'report' | 'scan' | 'ecg' | 'video' | 'photo'

export type Sniffed = { kind: FileKind; mime: string; category: Category }

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const MIME_FOR: Record<FileKind, string> = {
  pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', tiff: 'image/tiff',
  dicom: 'application/dicom', nifti: 'application/x-nifti', video: 'video/mp4', ecg_xml: 'application/xml', ecg_scp: 'application/x-scp-ecg',
  docx: DOCX_MIME, text: 'text/plain', zip: 'application/zip',
}

const CATEGORY: Record<FileKind, Category> = {
  pdf: 'report', docx: 'report', text: 'report', zip: 'report',
  dicom: 'scan', nifti: 'scan', ecg_xml: 'ecg', ecg_scp: 'ecg', video: 'video',
  jpeg: 'photo', png: 'photo', webp: 'photo', heic: 'photo', tiff: 'photo',
}

/** Kinds that are stored and shown but never read for facts (no text, no OCR). */
export const STORED_ONLY: readonly FileKind[] = ['dicom', 'nifti', 'video', 'ecg_xml', 'ecg_scp']
export const isStoredOnly = (k: FileKind) => STORED_ONLY.includes(k)
/** Kinds that become pages of text for the normal evidence-gated pipeline. */
export const READ_AS_TEXT: readonly FileKind[] = ['pdf', 'docx', 'text', 'jpeg', 'png', 'webp', 'heic', 'tiff']

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])
const VIDEO_BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'qt  ', 'm4v ', 'mmp4', 'MSNV', 'f4v '])

const ascii = (b: Uint8Array, s: number, e: number) => String.fromCharCode(...b.subarray(s, Math.min(e, b.length)))

/** True for text with no control characters other than tab/newline (UTF-8 or Latin-1 clean enough to show). */
export function looksLikeText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 8192)
  if (!n) return false
  for (let i = 0; i < n; i++) {
    const c = b[i]
    if (c === 0 || (c < 9) || (c > 13 && c < 32 && c !== 27)) return false
  }
  return true
}

export function isDocx(b: Uint8Array): boolean {
  try {
    const files = unzipSync(b as Uint8Array, { filter: (f) => f.name === '[Content_Types].xml' || f.name === 'word/document.xml' })
    return !!files['word/document.xml']
  } catch { return false }
}

/** Sniffs bytes. `name` is used only to tell .nii.gz and .scp apart (formats with no strong magic number). Returns null if unknown. */
export function sniffFile(b: Uint8Array, name = ''): Sniffed | null {
  const lower = name.toLowerCase()
  const out = (kind: FileKind, mime = MIME_FOR[kind]): Sniffed => ({ kind, mime, category: CATEGORY[kind] })
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return out('jpeg')
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return out('png')
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return out('webp')
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12)
    if (HEIF_BRANDS.has(brand)) return out('heic')
    if (VIDEO_BRANDS.has(brand)) return out('video', brand === 'qt  ' ? 'video/quicktime' : 'video/mp4')
    return null
  }
  if (b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a))) return out('tiff')
  if (b.length >= 132 && ascii(b, 128, 132) === 'DICM') return out('dicom')
  if (b.length >= 348 && ascii(b, 344, 347) === 'n+1' && b[347] === 0) return out('nifti')
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b && lower.endsWith('.nii.gz')) return out('nifti', 'application/gzip')
  const head = Buffer.from(b.subarray(0, 1024)).toString('latin1')
  if (head.indexOf('%PDF-') !== -1) return out('pdf')
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6)) return isDocx(b) ? out('docx') : out('zip')
  // SCP-ECG: bytes 2..5 hold the record length (little endian) and must equal the file size.
  if (b.length >= 16 && lower.endsWith('.scp') && new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(2, true) === b.length) return out('ecg_scp')
  if (looksLikeText(b)) {
    const text = Buffer.from(b.subarray(0, 4096)).toString('utf8')
    if (/^\s*(<\?xml[^>]*\?>\s*)?</.test(text)) {
      if (/AnnotatedECG|urn:hl7-org:v3|RestingECG|restingecgdata|CardiologyXML|<ECG\b|<sapphire|<ekg/i.test(text)) return out('ecg_xml')
      return null // other XML: not a clinical file we know
    }
    return out('text')
  }
  return null
}

export const CATEGORY_LABEL: Record<Category, string> = { report: 'Report', scan: 'Scan', ecg: 'ECG', video: 'Video', photo: 'Photo' }

/** The line shown for anything that is not read as text. */
export function storedNote(category: Category, kind: FileKind): string {
  if (kind === 'dicom' || kind === 'nifti') return 'Imaging file — stored, not read'
  if (category === 'ecg') return 'ECG file — stored, not read'
  if (category === 'video') return 'Video file — stored, not read'
  return 'File — stored, not read'
}
