// The ZIP limits as ONE rule, used by the server (src/server/pipeline/zip.ts) and by the browser BEFORE uploading. The browser
// reads only the directory at the end of the file (never the whole file), so an imaging CD the server would refuse is refused
// straight away, with the reason, instead of after minutes of uploading. The server checks everything again.
import { MAX_ZIP_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_RATIO, MAX_ZIP_UNCOMPRESSED_BYTES, MB } from '@/core/limits'
import type { PatientKey } from '@/i18n/patient'

export type ZipSummary = { entries: number; unpackedBytes: number; bomb: boolean; nestedArchives: number; others: number }
type LimitCode = 'zip_too_large' | 'zip_too_many_files' | 'zip_too_big_unpacked' | 'zip_bomb'
export type ZipRefusalCode = LimitCode | 'zip_only_archives'
/** `message` is plain English with the numbers (staff screens and the server's reply). Patients get PATIENT_ZIP_REASON in their language. */
export type ZipRefusal = { code: ZipRefusalCode; message: string }

const ARCHIVE = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i
export const ZIP_JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i
const mb = (n: number) => `${Math.round(n / MB)} MB`
const num = (n: number) => n.toLocaleString('en-US')

/** What the directory says, from each entry's name and its packed and unpacked sizes. Every file counts; folders do not. */
export function zipSummary(list: Iterable<{ name: string; size: number; originalSize: number }>): ZipSummary {
  const s: ZipSummary = { entries: 0, unpackedBytes: 0, bomb: false, nestedArchives: 0, others: 0 }
  for (const f of list) {
    if (f.name.endsWith('/')) continue
    s.entries++; s.unpackedBytes += f.originalSize
    if (f.originalSize > MB && f.originalSize / Math.max(f.size, 1) > MAX_ZIP_RATIO) s.bomb = true
    if (!ZIP_JUNK.test(f.name)) { if (ARCHIVE.test(f.name)) s.nestedArchives++; else s.others++ }
  }
  return s
}

/** Why a ZIP of this size and directory is refused, or null. Pure. */
export function zipRefusal(s: ZipSummary, size: number): { code: LimitCode; message: string } | null {
  const split = 'Send the study in two or more ZIPs.'
  if (size > MAX_ZIP_BYTES) return { code: 'zip_too_large', message: `This ZIP is ${mb(size)}; a ZIP must be ${mb(MAX_ZIP_BYTES)} or smaller. ${split}` }
  if (s.entries > MAX_ZIP_ENTRIES) return { code: 'zip_too_many_files', message: `This ZIP holds ${num(s.entries)} files; a ZIP may hold at most ${num(MAX_ZIP_ENTRIES)}. ${split}` }
  if (s.unpackedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) return { code: 'zip_too_big_unpacked', message: `This ZIP is ${mb(s.unpackedBytes)} once opened; the most is ${mb(MAX_ZIP_UNCOMPRESSED_BYTES)}. ${split}` }
  if (s.bomb) return { code: 'zip_bomb', message: 'The ZIP was refused because a file in it expands far too much (a damaged or unsafe ZIP).' }
  return null
}

/** Reads the central directory of a ZIP held in a Blob. Null when it cannot be read, or uses ZIP64 (the server then decides). */
export async function readZipDirectory(blob: Blob): Promise<ZipSummary | null> {
  const tailLen = Math.min(blob.size, 65557)
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer())
  let eocd = -1
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) return null
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOffset = tail.getUint32(eocd + 16, true)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff || cdOffset + cdSize > blob.size) return null
  const buf = await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer()
  const dv = new DataView(buf), bytes = new Uint8Array(buf), dec = new TextDecoder()
  const list: { name: string; size: number; originalSize: number }[] = []
  for (let p = 0; list.length < count && p + 46 <= buf.byteLength && dv.getUint32(p, true) === 0x02014b50;) {
    const size = dv.getUint32(p + 20, true), originalSize = dv.getUint32(p + 24, true)
    if (size === 0xffffffff || originalSize === 0xffffffff) return null // ZIP64 sizes
    const nameLen = dv.getUint16(p + 28, true)
    list.push({ name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)), size, originalSize })
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true)
  }
  return list.length === count ? zipSummary(list) : null
}

/** Checks a file chosen for upload. Anything that is not a ZIP, or cannot be read, passes (the server checks it again). */
export async function checkZipBeforeUpload(blob: Blob, name: string): Promise<{ ok: true } | ({ ok: false } & ZipRefusal)> {
  if (!/\.zip$/i.test(name)) return { ok: true }
  const s = await readZipDirectory(blob).catch(() => null)
  const r = zipRefusal(s ?? { entries: 0, unpackedBytes: 0, bomb: false, nestedArchives: 0, others: 1 }, blob.size)
    ?? (s && s.nestedArchives > 0 && s.others === 0
      ? { code: 'zip_only_archives' as const, message: `This ZIP holds only other archives (${num(s.nestedArchives)}). A ZIP inside a ZIP is not opened: open it first and upload what is inside.` }
      : null)
  return r ? { ok: false, ...r } : { ok: true }
}

/** The patient's sentence for each refusal (src/i18n/patient.ts), for the browser check and for the same codes from the server. */
export const PATIENT_ZIP_REASON: Record<ZipRefusalCode | 'zip_unreadable' | 'zip_nothing_accepted' | 'zip_empty', PatientKey> = {
  zip_too_large: 'zipTooLarge', zip_too_many_files: 'zipTooManyFiles', zip_too_big_unpacked: 'zipTooBigUnpacked', zip_bomb: 'zipBomb',
  zip_only_archives: 'zipOnlyArchives', zip_unreadable: 'zipUnreadable', zip_nothing_accepted: 'zipNothingAccepted', zip_empty: 'zipNothingAccepted',
}
/** The limits, as the patient sentences name them. */
export const zipReasonVars = { maxZip: mb(MAX_ZIP_BYTES), maxFiles: num(MAX_ZIP_ENTRIES), maxUnpacked: mb(MAX_ZIP_UNCOMPRESSED_BYTES) }
