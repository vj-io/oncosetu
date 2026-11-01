// Canonical JSON, client-safe (no node:crypto): the ledger seals with it and the share viewer re-derives signed bytes with it.

/** Canonical JSON (RFC 8785 style): sorted keys, no whitespace, shortest round-trip numbers; undefined object members dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number')
    return JSON.stringify(value) // shortest round-trip; -0 → "0"
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') return canonicalJson((value as { toJSON: () => unknown }).toJSON())
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined || typeof v === 'function' ? 'null' : canonicalJson(v))).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && typeof v !== 'function')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  throw new Error(`canonicalJson: unsupported ${typeof value}`)
}
