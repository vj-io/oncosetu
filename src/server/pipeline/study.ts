// A DICOM study kept as one document: the instances are stored together as a stored (uncompressed) ZIP bundle.
import { unzipSync, Zip, ZipDeflate, ZipPassThrough, zipSync } from 'fflate'
import { parseDicomHeader } from './dicom'

export const STUDY_BUNDLE_MIME = 'application/x-dicom-study'
/** Slices of a study bundle in reading order (instance number, then name). */
export function orderedInstances(zipBytes: Uint8Array): Uint8Array[] {
  const files = unzipSync(zipBytes)
  return Object.entries(files)
    .map(([name, data]) => { let n = 0; try { n = parseDicomHeader(data).meta.instanceNumber ?? 0 } catch { /* keep 0 */ } return { name, data, n } })
    .sort((a, b) => a.n - b.n || (a.name < b.name ? -1 : 1)).map((x) => x.data)
}

/**
 * Bundles instances (name to bytes) into one ZIP. Pictures that are already compressed (JPEG 2000 and the like) are stored as they
 * are; `squeeze` names the uncompressed ones, which are deflated lightly so a large study fits in one database row.
 */
export function bundleInstances(files: Record<string, Uint8Array>, squeeze: ReadonlySet<string> = new Set()): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([n, d]) => [n, [d, { level: squeeze.has(n) ? 1 : 0 }] as [Uint8Array, { level: 0 | 1 }]])))
}

/** Names in a bundle, in ZIP order. Reads the directory only; nothing is inflated. */
export function bundleNames(zipBytes: Uint8Array): string[] {
  const names: string[] = []
  unzipSync(zipBytes, { filter: (f) => { names.push(f.name); return false } })
  return names
}

const BUNDLE_NAME = /^\d{4,}-/
/**
 * One slice of a bundle by position (the middle one when none is asked for), inflating only that slice. Bundles made by the upload
 * path name their files `0001-...` in reading order, so the position is the name order; any other bundle falls back to sorting by
 * the header's instance number.
 */
export function bundleSliceAt(zipBytes: Uint8Array, index?: number): { count: number; data: Uint8Array | null } {
  const names = bundleNames(zipBytes)
  if (names.length && names.every((n) => BUNDLE_NAME.test(n))) {
    const sorted = names.sort()
    const pick = sorted[Math.min(Math.max(index ?? Math.floor(sorted.length / 2), 0), sorted.length - 1)]
    const out = unzipSync(zipBytes, { filter: (f) => f.name === pick })
    return { count: sorted.length, data: out[pick] ?? null }
  }
  const all = orderedInstances(zipBytes)
  return { count: all.length, data: all[Math.min(Math.max(index ?? Math.floor(all.length / 2), 0), all.length - 1)] ?? null }
}

/**
 * Builds a bundle one slice at a time (nothing but the packed result is kept), so a study of 2,500 slices never exists in memory
 * as a second full copy. `squeeze` deflates an uncompressed picture lightly; already-compressed pictures are stored as they are.
 */
export class BundleWriter {
  private chunks: Uint8Array[] = []
  private zip: Zip
  size = 0
  constructor(private maxBytes: number) {
    this.zip = new Zip((err, chunk) => { if (err) throw err; this.chunks.push(chunk); this.size += chunk.length })
  }
  /** Returns false once the bundle has grown past its limit (the caller then stops and refuses the study). */
  add(name: string, data: Uint8Array, squeeze: boolean): boolean {
    // each deflater costs a few ms to set up, so only pictures big enough to repay it are squeezed
    const f = squeeze && data.length >= 128 * 1024 ? new ZipDeflate(name, { level: 1 }) : new ZipPassThrough(name)
    this.zip.add(f)
    f.push(data, true)
    return this.size <= this.maxBytes
  }
  finish(): Uint8Array {
    this.zip.end()
    const out = new Uint8Array(this.size)
    let o = 0
    for (const c of this.chunks) { out.set(c, o); o += c.length }
    this.chunks = []
    return out
  }
}
