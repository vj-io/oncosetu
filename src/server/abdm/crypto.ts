// ABDM health-information encryption (the "Fidelius" scheme of the ABDM HIP/HIU reference), with node:crypto only.
//
// Both sides make an ephemeral Curve25519 key pair and a 32-byte random nonce per transfer, and exchange the public key
// + nonce as `keyMaterial` ({ cryptoAlg: 'ECDH', curve: 'Curve25519', dhPublicKey: { expiry, parameters, keyValue }, nonce }).
// Each entry's `content` is then, for the side holding private key `d` and receiving the peer's public key `Q`:
//
//   shared  = X25519(d, Q)                                   32 bytes (RFC 7748; identical on both sides)
//   xor     = ownNonce XOR peerNonce                         32 bytes (order-free, so both sides get the same value)
//   salt    = xor[0..20)                                     first 20 bytes  -> HKDF salt
//   iv      = xor[20..32)                                    last 12 bytes   -> AES-GCM IV
//   key     = HKDF-SHA256(ikm = shared, salt, info = empty, L = 32)
//   content = base64( AES-256-GCM(key, iv, plaintext, no AAD) ciphertext || 16-byte tag )
//
// This is the reference's split: `salt = xor[0..20)` and `iv = xor[len-12..len)` (Fidelius `FideliusEncryptionService`).
// The XORed nonce is NOT used whole as the salt, and its first 20 bytes are the salt, not the IV (a 20-byte GCM IV
// would be hashed by GHASH and never interoperate).
//
// Key encoding: `keyValue` is base64 of the X.509 SubjectPublicKeyInfo DER of the X25519 key (OID 1.3.101.110, 44 bytes).
// ponytail: the ABDM reference (BouncyCastle) encodes keys as points on the *Weierstrass* form of Curve25519 and runs
// ECDH there (shared x = X25519 u + 486662/3 mod p). Byte-level interop with a live HIP needs a Montgomery<->Weierstrass
// adapter for keyValue and the shared secret; add it when a sandbox account exists (the derivation above is unchanged).
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes, type KeyObject } from 'node:crypto'

export const CURVE = 'Curve25519'
export const KEY_PARAMETERS = 'Curve25519/32byte random key'
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex')

export type DhPublicKey = { expiry: string; parameters: string; keyValue: string }
export type KeyMaterial = { cryptoAlg: 'ECDH'; curve: typeof CURVE; dhPublicKey: DhPublicKey; nonce: string }
/** One side of a transfer: the private key never leaves memory; only `keyMaterial` is sent. */
export type Ephemeral = { privateKey: KeyObject; keyMaterial: KeyMaterial }

export class AbdmCryptoError extends Error {
  constructor(public code: 'bad_key' | 'bad_nonce' | 'key_expired' | 'decrypt_failed') {
    super(code)
    this.name = 'AbdmCryptoError'
  }
}

/** X25519 private key from 32 raw bytes (test vectors); normal use is ephemeral(). */
export function privateKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new AbdmCryptoError('bad_key')
  return createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: 'der', type: 'pkcs8' })
}

export const keyValueOf = (privateKey: KeyObject): string =>
  (createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer).toString('base64')

function peerPublicKey(keyValue: string): KeyObject {
  const der = Buffer.from(keyValue, 'base64')
  if (der.length !== 44 || !der.subarray(0, 12).equals(SPKI_X25519)) throw new AbdmCryptoError('bad_key')
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

function nonceBytes(b64: string): Buffer {
  const n = Buffer.from(b64, 'base64')
  if (n.length !== 32) throw new AbdmCryptoError('bad_nonce')
  return n
}

/** A fresh key pair + nonce for one transfer. `seed` fixes both (known-answer tests only). */
export function ephemeral(expiry: Date, seed?: { privateKey: Buffer; nonce: Buffer }): Ephemeral {
  const privateKey = privateKeyFromRaw(seed?.privateKey ?? randomBytes(32))
  const nonce = seed?.nonce ?? randomBytes(32)
  if (nonce.length !== 32) throw new AbdmCryptoError('bad_nonce')
  return {
    privateKey,
    keyMaterial: {
      cryptoAlg: 'ECDH', curve: CURVE, nonce: nonce.toString('base64'),
      dhPublicKey: { expiry: expiry.toISOString(), parameters: KEY_PARAMETERS, keyValue: keyValueOf(privateKey) },
    },
  }
}

/** Every intermediate of the derivation (exposed for the known-answer tests). */
export function deriveSession(own: Ephemeral, peer: KeyMaterial, at = new Date()) {
  if (peer.cryptoAlg !== 'ECDH' || peer.curve !== CURVE) throw new AbdmCryptoError('bad_key')
  if (!(Date.parse(peer.dhPublicKey.expiry) > at.getTime())) throw new AbdmCryptoError('key_expired')
  const shared = diffieHellman({ privateKey: own.privateKey, publicKey: peerPublicKey(peer.dhPublicKey.keyValue) })
  const a = nonceBytes(own.keyMaterial.nonce), b = nonceBytes(peer.nonce)
  const xor = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) xor[i] = a[i] ^ b[i]
  const salt = xor.subarray(0, 20), iv = xor.subarray(20, 32)
  const key = Buffer.from(hkdfSync('sha256', shared, salt, Buffer.alloc(0), 32))
  return { shared, xor, salt, iv, key }
}

export function encryptEntry(plaintext: Buffer | string, own: Ephemeral, peer: KeyMaterial, at = new Date()): string {
  const { key, iv } = deriveSession(own, peer, at)
  const c = createCipheriv('aes-256-gcm', key, iv)
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]).toString('base64')
}

/** Throws AbdmCryptoError('decrypt_failed') on any tampering (tag mismatch), wrong key or wrong nonce. */
export function decryptEntry(content: string, own: Ephemeral, peer: KeyMaterial, at = new Date()): Buffer {
  const { key, iv } = deriveSession(own, peer, at)
  const blob = Buffer.from(content, 'base64')
  if (blob.length < 17) throw new AbdmCryptoError('decrypt_failed')
  try {
    const d = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
    d.setAuthTag(blob.subarray(blob.length - 16))
    return Buffer.concat([d.update(blob.subarray(0, blob.length - 16)), d.final()])
  } catch {
    throw new AbdmCryptoError('decrypt_failed')
  }
}
