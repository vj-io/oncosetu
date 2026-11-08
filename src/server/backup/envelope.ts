// Backup envelope: AES-256-GCM over the whole (already gzipped) backup stream, with a dedicated key.
//   BACKUP_KEY           base64, 32 bytes — encrypts new backups (and reads them)
//   BACKUP_KEY_PREVIOUS  optional, base64, 32 bytes — still reads backups made before a rotation, until they age out
//
// Layout (version 1):  "OSBK" | 0x01 | keyIdLen (1 byte) | keyId (ascii) | iv (12) | ciphertext … | tag (16)
// The header is the GCM additional data, so a changed version, key id or IV fails the tag like a changed byte of data.
// Streamed both ways: memory stays at one chunk; decryption holds back the last 16 bytes (the tag) until the end.
import { createCipheriv, createDecipheriv, createHash, randomBytes, type DecipherGCM } from 'node:crypto'

const MAGIC = Buffer.from('OSBK')
const VERSION = 1

export type BackupKey = { id: string; key: Buffer }

/** Key id = a fingerprint of the key (not the key): restore can tell "wrong key" from "corrupt file". */
export function backupKey(b64: string): BackupKey {
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) throw new Error('backup key must be 32 bytes base64')
  return { id: 'bk_' + createHash('sha256').update('oncosetu-backup-key:').update(key).digest('hex').slice(0, 16), key }
}

/** The key that encrypts, then any previous key that may still be needed to decrypt. */
export function backupKeysFromEnv(): BackupKey[] {
  if (!process.env.BACKUP_KEY) throw new Error('BACKUP_KEY is not set')
  return [process.env.BACKUP_KEY, process.env.BACKUP_KEY_PREVIOUS].filter((k): k is string => !!k).map(backupKey)
}

export async function* encrypt(src: AsyncIterable<Buffer>, k: BackupKey): AsyncGenerator<Buffer> {
  const iv = randomBytes(12)
  const id = Buffer.from(k.id, 'ascii')
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION, id.length]), id, iv])
  const c = createCipheriv('aes-256-gcm', k.key, iv)
  c.setAAD(header)
  yield header
  for await (const chunk of src) { const out = c.update(chunk); if (out.length) yield out }
  const fin = c.final()
  if (fin.length) yield fin
  yield c.getAuthTag()
}

/** Throws on a wrong key, an unknown format or any changed byte (the last only once the stream ends: discard what came before). */
export async function* decrypt(src: AsyncIterable<Buffer>, keys: BackupKey[]): AsyncGenerator<Buffer> {
  let buf: Buffer = Buffer.alloc(0)
  let d: DecipherGCM | undefined
  for await (const chunk of src) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    if (!d) {
      if (buf.length < 6) continue
      if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('not an OncoSetu backup')
      if (buf[4] !== VERSION) throw new Error(`unsupported backup version ${buf[4]}`)
      const headerLen = 6 + buf[5] + 12
      if (buf.length < headerLen) continue
      const keyId = buf.subarray(6, 6 + buf[5]).toString('ascii')
      const k = keys.find((x) => x.id === keyId)
      if (!k) throw new Error(`backup was encrypted with key ${keyId}; BACKUP_KEY / BACKUP_KEY_PREVIOUS are ${keys.map((x) => x.id).join(', ') || 'unset'}`)
      d = createDecipheriv('aes-256-gcm', k.key, buf.subarray(headerLen - 12, headerLen), { authTagLength: 16 })
      d.setAAD(buf.subarray(0, headerLen))
      buf = buf.subarray(headerLen)
    }
    if (buf.length > 16) {
      const out = d.update(buf.subarray(0, buf.length - 16))
      buf = buf.subarray(buf.length - 16)
      if (out.length) yield out
    }
  }
  if (!d || buf.length !== 16) throw new Error('backup is truncated')
  d.setAuthTag(buf)
  const fin = d.final() // throws "Unsupported state or unable to authenticate data" on any tampering
  if (fin.length) yield fin
}
