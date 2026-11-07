/**
 * Offline tamper check for a sealed snapshot (FR-PAS-05). Needs only the file downloaded from the printable passport
 * (GET /api/snapshots/[id]) and the public keys: no database, no private key, and no network once the keys are saved.
 *
 *   npx tsx scripts/verify-snapshot.ts snapshot-<id>.json keys.json                  # keys saved from GET /api/keys
 *   npx tsx scripts/verify-snapshot.ts snapshot-<id>.json https://<host>/api/keys    # or fetched now
 *
 * Prints OK or TAMPERED. Exit code 0 = OK, 1 = TAMPERED, 2 = the inputs could not be read.
 */
import { readFileSync } from 'node:fs'
import { verifySnapshotFile, type PublicKey, type SnapshotFile } from '../src/server/ledger/export'

async function main() {
  const [file, keysFrom] = process.argv.slice(2)
  if (!file || !keysFrom) {
    console.error('usage: npx tsx scripts/verify-snapshot.ts <snapshot.json> <keys.json | https://host/api/keys>')
    process.exit(2)
  }
  const keysJson = /^https?:\/\//.test(keysFrom) ? await (await fetch(keysFrom)).json() : JSON.parse(readFileSync(keysFrom, 'utf8'))
  const keys = (Array.isArray(keysJson) ? keysJson : keysJson.keys) as PublicKey[]
  const f = JSON.parse(readFileSync(file, 'utf8')) as SnapshotFile
  const v = verifySnapshotFile(f, keys)
  console.log(`Snapshot   ${f.snapshotId} (seq ${f.seq}), sealed ${f.sealedAt}`)
  console.log(`SHA-256    ${v.sha256} ${v.hashMatches ? '(matches the sealed hash)' : `(sealed hash was ${f.sha256})`}`)
  console.log(`Signature  Ed25519, key ${f.keyId ?? '—'}: ${!v.keyFound ? 'key not in the key list' : v.signatureValid ? 'valid' : 'NOT valid'}`)
  console.log(v.ok ? 'OK — the record is exactly as sealed. Compare the hash with the one printed on the passport.' : 'TAMPERED — this is not the record as sealed.')
  process.exit(v.ok ? 0 : 1)
}

main().catch((e: Error) => { console.error(`could not check: ${e.message}`); process.exit(2) })
