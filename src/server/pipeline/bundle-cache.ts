// Decrypted study bundles kept in this server instance for a few minutes, so stepping through a study reads and decrypts its
// stored part once instead of once per slice (a part can hold 100 MB; on a real CD every slice re-read it). Keyed by the stored
// file id, which the caller looked up under the patient's access check; stored originals never change.
type Entry = { bytes: Uint8Array; at: number }

export function makeBundleCache(maxBytes: number, ttlMs: number) {
  const entries = new Map<string, Entry>() // insertion order = least recently used first
  const loading = new Map<string, Promise<Uint8Array | null>>()
  let total = 0
  const drop = (id: string) => { const e = entries.get(id); if (e) { entries.delete(id); total -= e.bytes.length } }
  return {
    get size() { return total },
    async get(id: string, load: () => Promise<Uint8Array | null>, now = Date.now()): Promise<Uint8Array | null> {
      for (const [k, e] of entries) if (now - e.at > ttlMs) drop(k)
      const hit = entries.get(id)
      if (hit) { entries.delete(id); entries.set(id, { bytes: hit.bytes, at: now }); return hit.bytes }
      const pending = loading.get(id) // slices asked for at the same time share one read
      if (pending) return pending
      const p = load().finally(() => loading.delete(id))
      loading.set(id, p)
      const bytes = await p
      if (!bytes || bytes.length > maxBytes || entries.has(id)) return bytes
      entries.set(id, { bytes, at: now })
      total += bytes.length
      for (const k of entries.keys()) { if (total <= maxBytes) break; drop(k) }
      return bytes
    },
  }
}

/** One per server instance: up to 256 MB of bundles, each kept 10 minutes after it was last used. */
export const bundleCache = makeBundleCache(256 * 1024 * 1024, 10 * 60_000)
