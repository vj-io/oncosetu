import { describe, expect, it } from 'vitest'
import { createKeyBundle, open, openJson, PBKDF2_ITERATIONS, seal, sealJson, unlockKey, WrongPinError } from './crypto'

const enc = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>

describe('PIN-wrapped device key (FR-OFF-03)', () => {
  it('wraps with PBKDF2 at >= 310,000 iterations and a random salt', async () => {
    const a = await createKeyBundle('123456')
    const b = await createKeyBundle('123456')
    expect(a.bundle.iterations).toBeGreaterThanOrEqual(310_000)
    expect(a.bundle.iterations).toBe(PBKDF2_ITERATIONS)
    expect(a.bundle.salt).toHaveLength(16)
    expect(Buffer.from(a.bundle.salt).equals(Buffer.from(b.bundle.salt))).toBe(false)
    expect(Buffer.from(a.bundle.wrapped).equals(Buffer.from(b.bundle.wrapped))).toBe(false)
  })

  it('the right PIN unwraps the same key (data sealed before a "reload" opens after it)', async () => {
    const { bundle, key } = await createKeyBundle('482913')
    const sealed = await sealJson(key, { patientId: 'p1', pages: 2 }, 'cap-1')
    // what IndexedDB would hand back after a reload: a structured clone of the bundle
    const stored = { ...bundle, salt: new Uint8Array(bundle.salt), iv: new Uint8Array(bundle.iv), wrapped: bundle.wrapped.slice(0) }
    const reopened = await unlockKey(stored, '482913')
    expect(await openJson(reopened, sealed, 'cap-1')).toEqual({ patientId: 'p1', pages: 2 })
  })

  it('a wrong PIN, a short PIN or a non-digit PIN is a WrongPinError and yields no key', async () => {
    const { bundle } = await createKeyBundle('482913')
    for (const bad of ['482914', '48291', '4829133', 'abcdef', '']) {
      await expect(unlockKey(bundle, bad)).rejects.toBeInstanceOf(WrongPinError)
    }
  })

  it('refuses to create a bundle for a PIN that is not 6 digits', async () => {
    await expect(createKeyBundle('1234')).rejects.toThrow('pin_format')
  })

  it('the unwrapped device key cannot be exported', async () => {
    const { key } = await createKeyBundle('111111')
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
  })
})

describe('sealing captures', () => {
  it('stores ciphertext only: plaintext bytes do not appear, and each seal uses a fresh IV', async () => {
    const { key } = await createKeyBundle('654321')
    const secret = enc('PATIENT SUNITA DESHMUKH MRN-0042 ' + 'x'.repeat(200))
    const a = await seal(key, secret, 'page-1')
    const b = await seal(key, secret, 'page-1')
    expect(Buffer.from(a.ct).includes(Buffer.from('SUNITA'))).toBe(false)
    expect(Buffer.from(a.ct).equals(Buffer.from(b.ct))).toBe(false)
    expect(Buffer.from(await open(key, a, 'page-1')).equals(Buffer.from(secret))).toBe(true)
  })

  it('binds a ciphertext to its record id: moving it to another record fails to open', async () => {
    const { key } = await createKeyBundle('654321')
    const s = await seal(key, enc('page bytes'), 'file-A')
    await expect(open(key, s, 'file-B')).rejects.toThrow()
  })

  it('detects tampering', async () => {
    const { key } = await createKeyBundle('654321')
    const s = await seal(key, enc('page bytes'), 'file-A')
    const bytes = new Uint8Array(s.ct)
    bytes[0] ^= 1
    await expect(open(key, { iv: s.iv, ct: bytes.buffer }, 'file-A')).rejects.toThrow()
  })

  it('a different device key cannot open it', async () => {
    const one = await createKeyBundle('654321')
    const two = await createKeyBundle('654321')
    const s = await seal(one.key, enc('x'), 'id')
    await expect(open(two.key, s, 'id')).rejects.toThrow()
  })
})
