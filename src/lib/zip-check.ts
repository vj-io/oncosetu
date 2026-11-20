// Looks inside a ZIP in the browser BEFORE it is uploaded: reads only the directory at the end of the file (never the whole
// file), counts the entries, adds up their unpacked size and spots archives inside it, so an imaging CD that the server would
// refuse is refused straight away with the reason, instead of after minutes of uploading. The server checks everything again.
import { MAX_ZIP_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_UNCOMPRESSED_BYTES } from '@/core/limits'

export type ZipSummary = { entries: number; unpackedBytes: number; nestedArchives: number; others: number }
export type ZipCheck = { ok: true; summary: ZipSummary | null } | { ok: false; reason: string }

const ARCHIVE = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i
const mb = (n: number) => `${Math.round(n / 1048576)} MB`
const num = (n: number) => n.toLocaleString('en-US')

/** Reads the central directory of a ZIP held in a Blob. Returns null when it cannot be read (the server then decides). */
export async function readZipDirectory(blob: Blob): Promise<ZipSummary | null> {
  const tailLen = Math.min(blob.size, 65557 + 20)
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer())
  let eocd = -1
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) return null
  let count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOffset = tail.getUint32(eocd + 16, true)
  if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) { // ZIP64
    const z64At = Number(tail.getBigUint64(eocd - 20 + 8, true))
    const z = new DataView(await blob.slice(z64At, z64At + 56).arrayBuffer())
    if (z.getUint32(0, true) !== 0x06064b50) return null
    count = Number(z.getBigUint64(32, true)); cdSize = Number(z.getBigUint64(40, true)); cdOffset = Number(z.getBigUint64(48, true))
  }
  if (cdSize > 64 * 1048576 || cdOffset + cdSize > blob.size) return null
  const buf = await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer()
  const dv = new DataView(buf), bytes = new Uint8Array(buf), dec = new TextDecoder()
  const s: ZipSummary = { entries: 0, unpackedBytes: 0, nestedArchives: 0, others: 0 }
  for (let p = 0, n = 0; n < count && p + 46 <= buf.byteLength && dv.getUint32(p, true) === 0x02014b50; n++) {
    let usize = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    if (usize === 0xffffffff) { // the real size is in the ZIP64 extra field
      for (let e = p + 46 + nameLen, end = e + extraLen; e + 4 <= end;) {
        const id = dv.getUint16(e, true), len = dv.getUint16(e + 2, true)
        if (id === 1 && len >= 8) { usize = Number(dv.getBigUint64(e + 4, true)); break }
        e += 4 + len
      }
    }
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || JUNK.test(name)) continue
    s.entries++; s.unpackedBytes += usize
    if (ARCHIVE.test(name)) s.nestedArchives++; else s.others++
  }
  return s
}

/** The plain reason a ZIP would be refused, from its directory alone, or null when it looks fine. Pure. */
export function zipRefusal(s: ZipSummary, size: number): string | null {
  if (size > MAX_ZIP_BYTES) return `This ZIP is ${mb(size)}; a ZIP must be ${mb(MAX_ZIP_BYTES)} or smaller. Send the study in two or more ZIPs.`
  if (s.entries > MAX_ZIP_ENTRIES) return `This ZIP holds ${num(s.entries)} files; a ZIP may hold at most ${num(MAX_ZIP_ENTRIES)}. Send the study in two or more ZIPs.`
  if (s.unpackedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) return `This ZIP is ${mb(s.unpackedBytes)} once opened; the most is ${mb(MAX_ZIP_UNCOMPRESSED_BYTES)}. Send the study in two or more ZIPs.`
  if (s.nestedArchives > 0 && s.others === 0) return `This ZIP holds only other archives (${num(s.nestedArchives)}). A ZIP inside a ZIP is not opened: open it first and upload what is inside.`
  return null
}

/** Checks a file chosen for upload. Anything that is not a ZIP, or cannot be read, passes (the server checks it again). */
export async function checkZipBeforeUpload(blob: Blob, name: string): Promise<ZipCheck> {
  if (!/\.zip$/i.test(name)) return { ok: true, summary: null }
  let summary: ZipSummary | null = null
  try { summary = await readZipDirectory(blob) } catch { summary = null }
  const reason = summary ? zipRefusal(summary, blob.size) : blob.size > MAX_ZIP_BYTES ? zipRefusal({ entries: 0, unpackedBytes: 0, nestedArchives: 0, others: 1 }, blob.size) : null
  return reason ? { ok: false, reason } : { ok: true, summary }
}
