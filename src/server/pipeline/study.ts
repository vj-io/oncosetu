// A DICOM study kept as one document: the instances are stored together as a stored (uncompressed) ZIP bundle.
import { unzipSync, zipSync } from 'fflate'
import { parseDicomHeader } from './dicom'

export const STUDY_BUNDLE_MIME = 'application/x-dicom-study'
/** Slices of a study bundle in reading order (instance number, then name). */
export function orderedInstances(zipBytes: Uint8Array): Uint8Array[] {
  const files = unzipSync(zipBytes)
  return Object.entries(files)
    .map(([name, data]) => { let n = 0; try { n = parseDicomHeader(data).meta.instanceNumber ?? 0 } catch { /* keep 0 */ } return { name, data, n } })
    .sort((a, b) => a.n - b.n || (a.name < b.name ? -1 : 1)).map((x) => x.data)
}

/** Bundles instances (name to bytes) into one stored ZIP. */
export function bundleInstances(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([n, d]) => [n, [d, { level: 0 }] as [Uint8Array, { level: 0 }]])))
}
