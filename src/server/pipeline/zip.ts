// Safe ZIP opening and DICOM study grouping. Pure over bytes (no DB). Nothing is ever written to disk, so path tricks cannot
// escape anywhere, but names are still checked and refused. Limits live in src/core/limits.ts.
import { unzipSync } from 'fflate'
import { MAX_ZIP_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_RATIO, MAX_ZIP_UNCOMPRESSED_BYTES } from '@/core/limits'
import { readDicomMeta, studyLabel, type DicomMeta } from './dicom'
import { sniffFile } from './filetypes'

export type ZipEntry = { name: string; base: string; data: Uint8Array }
export type Skipped = { name: string; reason: string; /** set when the entry was refused for safety (audited), not merely skipped */ code?: string }
export type ZipPlan = { ok: true; entries: ZipEntry[]; skipped: Skipped[] } | { ok: false; code: 'zip_too_large' | 'zip_unreadable' | 'zip_too_many_files' | 'zip_too_big_unpacked' | 'zip_bomb' | 'zip_empty'; message: string }

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i
const unsafeName = (n: string) => n.startsWith('/') || n.startsWith('\\') || /(^|[\\/])\.\.([\\/]|$)/.test(n) || /^[A-Za-z]:/.test(n) || n.includes('\0')

/** Opens a ZIP with zip-bomb protection. Sizes are checked from the directory before anything is inflated. */
export function planZip(zip: Uint8Array): ZipPlan {
  if (zip.length > MAX_ZIP_BYTES) return { ok: false, code: 'zip_too_large', message: `A ZIP must be ${MAX_ZIP_BYTES / 1048576} MB or smaller` }
  const listing: { name: string; size: number; originalSize: number }[] = []
  try {
    unzipSync(zip, { filter: (f) => { listing.push({ name: f.name, size: f.size, originalSize: f.originalSize }); return false } })
  } catch { return { ok: false, code: 'zip_unreadable', message: 'The ZIP could not be opened' } }
  const files = listing.filter((f) => !f.name.endsWith('/'))
  if (files.length > MAX_ZIP_ENTRIES) return { ok: false, code: 'zip_too_many_files', message: `A ZIP may hold at most ${MAX_ZIP_ENTRIES} files` }
  if (files.reduce((a, f) => a + f.originalSize, 0) > MAX_ZIP_UNCOMPRESSED_BYTES) return { ok: false, code: 'zip_too_big_unpacked', message: 'The ZIP is too large once opened' }
  const skipped: Skipped[] = []
  const take = new Set<string>()
  for (const f of files) {
    if (unsafeName(f.name)) { skipped.push({ name: f.name.slice(0, 80), reason: 'unsafe file name', code: 'unsafe_file_name' }); continue }
    if (JUNK.test(f.name)) { skipped.push({ name: f.name.slice(0, 80), reason: 'system file' }); continue }
    if (f.originalSize === 0) { skipped.push({ name: f.name, reason: 'empty file' }); continue }
    if (f.originalSize / Math.max(f.size, 1) > MAX_ZIP_RATIO && f.originalSize > 1 << 20) return { ok: false, code: 'zip_bomb', message: 'The ZIP was refused because a file in it expands far too much' }
    take.add(f.name)
  }
  if (!take.size && !skipped.length) return { ok: false, code: 'zip_empty', message: 'The ZIP is empty' }
  let out: Record<string, Uint8Array> = {}
  try { out = unzipSync(zip, { filter: (f) => take.has(f.name) }) } catch { return { ok: false, code: 'zip_unreadable', message: 'The ZIP could not be opened' } }
  const entries: ZipEntry[] = []
  for (const [name, data] of Object.entries(out)) {
    const listed = listing.find((l) => l.name === name)
    if (listed && data.length !== listed.originalSize) return { ok: false, code: 'zip_bomb', message: 'The ZIP was refused because it does not match its own listing' }
    const base = name.split(/[\\/]/).pop() ?? name
    const kind = sniffFile(data, base)?.kind
    if (kind === 'zip') { skipped.push({ name, reason: 'a ZIP inside a ZIP is not accepted', code: 'nested_archive' }); continue }
    if (base.toUpperCase() === 'DICOMDIR') { skipped.push({ name, reason: 'DICOMDIR index (not needed, the images are read directly)' }); continue }
    entries.push({ name, base, data })
  }
  return { ok: true, entries, skipped }
}

export type StudyGroup = { studyUid: string | null; label: string; instances: { entry: ZipEntry; meta: DicomMeta }[]; modalities: string[] }

/** Splits entries into DICOM studies (grouped by StudyInstanceUID) and everything else. */
export function groupDicom(entries: ZipEntry[]): { studies: StudyGroup[]; others: ZipEntry[] } {
  const byStudy = new Map<string, StudyGroup>()
  const others: ZipEntry[] = []
  for (const entry of entries) {
    if (sniffFile(entry.data, entry.base)?.kind !== 'dicom') { others.push(entry); continue }
    const meta = readDicomMeta(entry.data)
    if (!meta) { others.push(entry); continue } // a header that cannot be read goes through intake alone (and is held or refused there)
    const key = meta.studyUid ?? `single:${entry.name}`
    const g = byStudy.get(key) ?? { studyUid: meta.studyUid, label: '', instances: [], modalities: [] }
    g.instances.push({ entry, meta })
    if (meta.modality && !g.modalities.includes(meta.modality)) g.modalities.push(meta.modality)
    byStudy.set(key, g)
  }
  const studies = [...byStudy.values()].map((g) => ({ ...g, label: studyLabel(g.modalities) }))
  return { studies, others }
}
