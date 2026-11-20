// Safe ZIP opening and DICOM study grouping. Pure over bytes (no DB). Nothing is ever written to disk, so path tricks cannot
// escape anywhere, but names are still checked and refused. Limits live in src/core/limits.ts.
import { unzipSync } from 'fflate'
import { MAX_ZIP_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_RATIO, MAX_ZIP_UNCOMPRESSED_BYTES } from '@/core/limits'
import { readDicomMeta, studyLabel, type DicomMeta } from './dicom'
import { sniffFile } from './filetypes'

export type ZipEntry = { name: string; base: string; data: Uint8Array }
export type Skipped = { name: string; reason: string; /** set when the entry was refused for safety (audited), not merely skipped */ code?: string }
export type ZipRefusal = { ok: false; code: 'zip_too_large' | 'zip_unreadable' | 'zip_too_many_files' | 'zip_too_big_unpacked' | 'zip_bomb' | 'zip_empty'; message: string }
export type ZipPlan = { ok: true; entries: ZipEntry[]; skipped: Skipped[] } | ZipRefusal

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i
const unsafeName = (n: string) => n.startsWith('/') || n.startsWith('\\') || /(^|[\\/])\.\.([\\/]|$)/.test(n) || /^[A-Za-z]:/.test(n) || n.includes('\0')
const mb = (n: number) => `${Math.round(n / 1048576)} MB`
const num = (n: number) => n.toLocaleString('en-US')

/** What the ZIP directory says, checked before anything is inflated. `take` is the entries worth opening, with their unpacked sizes. */
export type ZipInspect = { ok: true; take: Map<string, number>; skipped: Skipped[] } | ZipRefusal

/** Opens a ZIP's directory with zip-bomb protection. Sizes are checked from the directory before anything is inflated. */
export function inspectZip(zip: Uint8Array): ZipInspect {
  if (zip.length > MAX_ZIP_BYTES) return { ok: false, code: 'zip_too_large', message: `This ZIP is ${mb(zip.length)}; a ZIP must be ${mb(MAX_ZIP_BYTES)} or smaller` }
  const listing: { name: string; size: number; originalSize: number }[] = []
  try {
    unzipSync(zip, { filter: (f) => { listing.push({ name: f.name, size: f.size, originalSize: f.originalSize }); return false } })
  } catch { return { ok: false, code: 'zip_unreadable', message: 'The ZIP could not be opened' } }
  const files = listing.filter((f) => !f.name.endsWith('/'))
  if (files.length > MAX_ZIP_ENTRIES) return { ok: false, code: 'zip_too_many_files', message: `This ZIP holds ${num(files.length)} files; a ZIP may hold at most ${num(MAX_ZIP_ENTRIES)}` }
  const unpacked = files.reduce((a, f) => a + f.originalSize, 0)
  if (unpacked > MAX_ZIP_UNCOMPRESSED_BYTES) return { ok: false, code: 'zip_too_big_unpacked', message: `This ZIP is ${mb(unpacked)} once opened; the most is ${mb(MAX_ZIP_UNCOMPRESSED_BYTES)}` }
  const skipped: Skipped[] = []
  const take = new Map<string, number>()
  for (const f of files) {
    if (unsafeName(f.name)) { skipped.push({ name: f.name.slice(0, 80), reason: 'unsafe file name', code: 'unsafe_file_name' }); continue }
    if (JUNK.test(f.name)) { skipped.push({ name: f.name.slice(0, 80), reason: 'system file' }); continue }
    if (f.originalSize === 0) { skipped.push({ name: f.name, reason: 'empty file' }); continue }
    if (f.originalSize / Math.max(f.size, 1) > MAX_ZIP_RATIO && f.originalSize > 1 << 20) return { ok: false, code: 'zip_bomb', message: 'The ZIP was refused because a file in it expands far too much' }
    take.set(f.name, f.originalSize)
  }
  if (!take.size && !skipped.length) return { ok: false, code: 'zip_empty', message: 'The ZIP is empty' }
  return { ok: true, take, skipped }
}

/** Bytes inflated at once. Entries are opened a batch at a time, so a large study never sits in memory twice over. */
export const ZIP_BATCH_BYTES = 64 * 1048576

/**
 * Opens the named entries one batch at a time and hands them out one by one (each batch is released before the next is inflated).
 * Yields `null` data's error as a thrown ZipMismatch when an entry does not match its own directory (a bomb in disguise).
 */
export class ZipMismatch extends Error {}
export function* openEntries(zip: Uint8Array, take: ReadonlyMap<string, number>, only?: ReadonlySet<string>): Generator<ZipEntry> {
  const names = [...take.keys()].filter((n) => !only || only.has(n))
  let i = 0
  while (i < names.length) {
    const batch = new Set<string>()
    let bytes = 0
    while (i < names.length && (batch.size === 0 || bytes + take.get(names[i])! <= ZIP_BATCH_BYTES)) { batch.add(names[i]); bytes += take.get(names[i])!; i++ }
    let out: Record<string, Uint8Array>
    try { out = unzipSync(zip, { filter: (f) => batch.has(f.name) }) } catch { throw new ZipMismatch('The ZIP could not be opened') }
    for (const name of batch) {
      const data = out[name]
      if (!data || data.length !== take.get(name)) throw new ZipMismatch('The ZIP was refused because it does not match its own listing')
      yield { name, base: name.split(/[\\/]/).pop() ?? name, data }
      delete out[name]
    }
  }
}

/** Whole-ZIP version (everything in memory at once): used where the ZIP is small or the caller needs every entry together. */
export function planZip(zip: Uint8Array): ZipPlan {
  const info = inspectZip(zip)
  if (!info.ok) return info
  const skipped = [...info.skipped]
  const entries: ZipEntry[] = []
  try {
    for (const e of openEntries(zip, info.take)) {
      const kind = sniffFile(e.data, e.base)?.kind
      if (kind === 'zip') { skipped.push({ name: e.name, reason: 'a ZIP inside a ZIP is not accepted', code: 'nested_archive' }); continue }
      if (e.base.toUpperCase() === 'DICOMDIR') { skipped.push({ name: e.name, reason: 'DICOMDIR index (not needed, the images are read directly)' }); continue }
      entries.push(e)
    }
  } catch (e) {
    if (e instanceof ZipMismatch) return { ok: false, code: e.message.includes('listing') ? 'zip_bomb' : 'zip_unreadable', message: e.message }
    throw e
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
