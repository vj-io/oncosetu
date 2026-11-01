// Application-level crypto. Keys come from env and are read lazily (tests may set them at runtime).
//   APP_MASTER_KEY       base64, 32 bytes — wraps per-value DEKs (AES-256-GCM envelope)
//   HMAC_KEY             base64, 32 bytes — blind indexes (phone_hmac, token_hash, …)
//   SIGNING_KEY_ED25519  base64 of a PKCS#8 PEM Ed25519 private key; SIGNING_KEY_ID names it
import {
  createHash, createHmac, createPrivateKey, createPublicKey, randomBytes, scrypt as scryptCb, sign, timingSafeEqual,
  verify, createCipheriv, createDecipheriv, type KeyObject,
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, o: object) => Promise<Buffer>

function key32(name: 'APP_MASTER_KEY' | 'HMAC_KEY'): Buffer {
  const k = Buffer.from(process.env[name] ?? '', 'base64')
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes base64`)
  return k
}

// ── AES-256-GCM envelope ─────────────────────────────────────────────────────
// Field format: "v1." + base64url( wrapIv12 | wrapTag16 | wrappedDek32 | iv12 | tag16 | ciphertext )
// "v1" = master-key version; rotate by adding v2 and re-wrapping DEKs.
const V = 'v1'

function gcmEncrypt(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct])
}

function gcmDecrypt(key: Buffer, blob: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12))
  d.setAuthTag(blob.subarray(12, 28))
  return Buffer.concat([d.update(blob.subarray(28)), d.final()])
}

function wrapDek(dek: Buffer): Buffer { return gcmEncrypt(key32('APP_MASTER_KEY'), dek) } // 60 bytes
function unwrapDek(w: Buffer): Buffer { return gcmDecrypt(key32('APP_MASTER_KEY'), w) }

function parseVersioned(s: string): Buffer {
  const [v, body] = s.split('.', 2)
  if (v !== V || !body) throw new Error('unsupported ciphertext version')
  return Buffer.from(body, 'base64url')
}

export function encryptField(plain: string): string {
  const dek = randomBytes(32)
  return `${V}.${Buffer.concat([wrapDek(dek), gcmEncrypt(dek, Buffer.from(plain, 'utf8'))]).toString('base64url')}`
}

export function decryptField(enc: string): string {
  const b = parseVersioned(enc)
  return gcmDecrypt(unwrapDek(b.subarray(0, 60)), b.subarray(60)).toString('utf8')
}

/** For files: `bytes` → bytea column, `dekWrapped` → text column. */
export function encryptBytes(plain: Buffer): { bytes: Buffer; dekWrapped: string } {
  const dek = randomBytes(32)
  return { bytes: gcmEncrypt(dek, plain), dekWrapped: `${V}.${wrapDek(dek).toString('base64url')}` }
}

export function decryptBytes(bytes: Buffer, dekWrapped: string): Buffer {
  return gcmDecrypt(unwrapDek(parseVersioned(dekWrapped)), bytes)
}

// ── hashing, HMAC blind indexes ──────────────────────────────────────────────
/** Normalise free text for equality lookups: NFKC, lower-case, trimmed, single spaces. */
export function normalise(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
}

/** HMAC-SHA256 (HMAC_KEY) of the normalised value, hex. Use phoneHmac() for phone numbers. */
export function hmac(value: string): string {
  return createHmac('sha256', key32('HMAC_KEY')).update(normalise(value)).digest('hex')
}

export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Indian mobile → "+91XXXXXXXXXX"; other "+<cc>…" numbers kept as digits. null if not a phone number. */
export function normalizePhone(raw: string): string | null {
  const plus = raw.trim().startsWith('+')
  let d = raw.replace(/\D/g, '')
  if (!plus) {
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
    if (d.length === 10) d = '91' + d
  }
  return d.length >= 11 && d.length <= 15 ? '+' + d : null
}

export function phoneHmac(raw: string): string | null {
  const p = normalizePhone(raw)
  return p ? hmac(p) : null
}

/** "+91 ••••• •1234" */
export function maskPhone(raw: string): string {
  const p = normalizePhone(raw) ?? raw.replace(/\D/g, '')
  const cc = p.startsWith('+91') ? '+91' : p.slice(0, Math.max(1, p.length - 10))
  return `${cc} ••••• •${p.slice(-4)}`
}

// ── random tokens, base32 ────────────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0, val = 0, out = ''
  for (const byte of buf) {
    val = (val << 8) | byte
    bits += 8
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0, val = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('invalid base32')
    val = (val << 5) | i
    bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export function randomToken(bytes = 32, encoding: 'base32' | 'base64url' = 'base64url'): string {
  const b = randomBytes(bytes)
  return encoding === 'base32' ? base32Encode(b) : b.toString('base64url')
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

// ── passwords (scrypt) ───────────────────────────────────────────────────────
const SCRYPT = { N: 1 << 15, r: 8, p: 1 }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const h = await scrypt(password, salt, 32, { ...SCRYPT, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${h.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const h = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  })
  return timingSafeEqual(h, expected)
}

// ── Ed25519 signing ──────────────────────────────────────────────────────────
let signingKey: { id: string; priv: KeyObject; pub: KeyObject } | undefined

function signer() {
  if (!signingKey) {
    const pem = Buffer.from(process.env.SIGNING_KEY_ED25519 ?? '', 'base64').toString('utf8')
    const priv = createPrivateKey(pem)
    signingKey = { id: process.env.SIGNING_KEY_ID ?? 'k-default', priv, pub: createPublicKey(priv) }
  }
  return signingKey
}

/** Returns { signature (base64url), keyId }. */
export function signEd25519(bytes: Buffer | Uint8Array): { signature: string; keyId: string } {
  const s = signer()
  return { signature: sign(null, bytes, s.priv).toString('base64url'), keyId: s.id }
}

// ponytail: one active key; add retired public keys here when SIGNING_KEY_ID rotates (E-PAS-04).
export function verifyEd25519(bytes: Buffer | Uint8Array, signature: string, keyId: string): boolean {
  const s = signer()
  if (keyId !== s.id) return false
  try { return verify(null, bytes, s.pub, Buffer.from(signature, 'base64url')) } catch { return false }
}

export function publicKeys(): { keyId: string; alg: 'Ed25519'; publicKeyPem: string; publicKeyRaw: string }[] {
  const s = signer()
  const jwk = s.pub.export({ format: 'jwk' }) as { x: string }
  return [{ keyId: s.id, alg: 'Ed25519', publicKeyPem: s.pub.export({ format: 'pem', type: 'spki' }).toString(), publicKeyRaw: jwk.x }]
}
