// The downloadable form of a sealed snapshot and its offline tamper check (FR-PAS-05). No database and no private key:
// the check needs only the file and the public keys of GET /api/keys, so scripts/verify-snapshot.ts runs it anywhere.
import { createPublicKey, verify } from 'node:crypto'
import { canonicalJson } from '@/core/canonical'
import { sha256Hex } from '@/core/hash'
import type { Snapshot } from '@/core/ledger'
import type { snapshots } from '@/db/schema'

export type SnapshotFile = {
  snapshotId: string; seq: number; sealedAt: string; sha256: string; keyId: string | null; signature: string | null; snapshot: Snapshot
}
export type PublicKey = { keyId: string; publicKeyPem: string }

/** The stored row as a file. The snapshot is parsed so the file can be read (and pretty-printed); its canonical JSON is the sealed bytes. */
export const snapshotFile = (row: Pick<typeof snapshots.$inferSelect, 'id' | 'seq' | 'sealedAt' | 'sha256' | 'keyId' | 'signature' | 'canonicalJson'>): SnapshotFile => ({
  snapshotId: row.id, seq: row.seq, sealedAt: row.sealedAt.toISOString(), sha256: row.sha256, keyId: row.keyId, signature: row.signature,
  snapshot: JSON.parse(row.canonicalJson) as Snapshot,
})

/** Re-derives the sealed bytes with the app's canonical JSON, recomputes SHA-256 and checks the Ed25519 signature. */
export function verifySnapshotFile(f: SnapshotFile, keys: readonly PublicKey[]) {
  const json = canonicalJson(f.snapshot)
  const sha256 = sha256Hex(json)
  const key = keys.find((k) => k.keyId === f.keyId)
  let signatureValid = false
  try {
    signatureValid = !!key && !!f.signature && verify(null, Buffer.from(json, 'utf8'), createPublicKey(key.publicKeyPem), Buffer.from(f.signature, 'base64url'))
  } catch { /* malformed key or signature: not valid */ }
  const hashMatches = sha256 === f.sha256
  return { ok: hashMatches && signatureValid, hashMatches, signatureValid, keyFound: !!key, sha256 }
}
