// Client-only. Device key wrapped by a PIN-derived key (FR-OFF-03).
//   PIN --PBKDF2-SHA-256 (310k, random salt)--> KEK --AES-GCM wrapKey--> random AES-GCM-256 device key (DEK)
// Every queued payload is AES-GCM sealed under the DEK with its record id as additional data, so a ciphertext
// cannot be moved to another record. Only the wrapped DEK is persisted; the unwrapped key is non-extractable
// and lives in memory until the page reloads or the staff member locks the app.
export const PBKDF2_ITERATIONS = 310_000
export const PIN_RE = /^\d{6}$/

export type Bytes = Uint8Array<ArrayBuffer>
export type KeyBundle = { v: 1; iterations: number; salt: Bytes; iv: Bytes; wrapped: ArrayBuffer }
export type Sealed = { iv: Bytes; ct: ArrayBuffer }

export class WrongPinError extends Error {
  constructor() {
    super('wrong_pin')
    this.name = 'WrongPinError'
  }
}

const subtle = () => globalThis.crypto.subtle
const rand = (n: number): Bytes => globalThis.crypto.getRandomValues(new Uint8Array(n))
const utf8 = (s: string): Bytes => new TextEncoder().encode(s) as Bytes

async function pinKey(pin: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', utf8(pin), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'],
  )
}

/** First use: generate the device key and wrap it under `pin`. Returns what to persist and the usable key. */
export async function createKeyBundle(pin: string): Promise<{ bundle: KeyBundle; key: CryptoKey }> {
  if (!PIN_RE.test(pin)) throw new Error('pin_format')
  const dek = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const salt = rand(16), iv = rand(12)
  const wrapped = await subtle().wrapKey('raw', dek, await pinKey(pin, salt, PBKDF2_ITERATIONS), { name: 'AES-GCM', iv })
  const bundle: KeyBundle = { v: 1, iterations: PBKDF2_ITERATIONS, salt, iv, wrapped }
  return { bundle, key: await unlockKey(bundle, pin) }
}

/** Unwrap the device key (non-extractable). A wrong PIN fails the GCM tag check: WrongPinError. */
export async function unlockKey(bundle: KeyBundle, pin: string): Promise<CryptoKey> {
  if (!PIN_RE.test(pin)) throw new WrongPinError()
  try {
    return await subtle().unwrapKey(
      'raw', bundle.wrapped, await pinKey(pin, bundle.salt, bundle.iterations),
      { name: 'AES-GCM', iv: bundle.iv }, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
    )
  } catch {
    throw new WrongPinError()
  }
}

/** `aad` is the owning record's id; opening with a different id fails. */
export async function seal(key: CryptoKey, plain: Uint8Array<ArrayBuffer>, aad: string): Promise<Sealed> {
  const iv = rand(12)
  return { iv, ct: await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, plain) }
}

export async function open(key: CryptoKey, s: Sealed, aad: string): Promise<Bytes> {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: s.iv, additionalData: utf8(aad) }, key, s.ct))
}

export const sealJson = (key: CryptoKey, v: unknown, aad: string) => seal(key, utf8(JSON.stringify(v)), aad)
export async function openJson<T>(key: CryptoKey, s: Sealed, aad: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await open(key, s, aad))) as T
}
