import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  base32Decode, base32Encode, decryptBytes, decryptField, encryptBytes, encryptField, hashPassword, hmac, maskPhone,
  normalizePhone, phoneHmac, publicKeys, randomToken, sha256Hex, signEd25519, timingSafeEqualStr, verifyEd25519, verifyPassword,
} from './crypto'

const OLD = generateKeyPairSync('ed25519') // a rotated-out signing key, listed in SIGNING_KEYS_RETIRED

beforeAll(() => {
  process.env.SIGNING_KEYS_RETIRED = JSON.stringify({ 'k-old': Buffer.from(OLD.publicKey.export({ format: 'pem', type: 'spki' }).toString()).toString('base64') })
  process.env.APP_MASTER_KEY = randomBytes(32).toString('base64')
  process.env.HMAC_KEY = randomBytes(32).toString('base64')
  const { privateKey } = generateKeyPairSync('ed25519')
  process.env.SIGNING_KEY_ED25519 = Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()).toString('base64')
  process.env.SIGNING_KEY_ID = 'k-test'
})

describe('envelope encryption', () => {
  it('round-trips fields, including Devanagari', () => {
    for (const s of ['', 'Sunita Devi', 'सुनीता देवी', '1975-03-12']) expect(decryptField(encryptField(s))).toBe(s)
  })
  it('uses a fresh DEK/IV per value and is versioned', () => {
    const a = encryptField('same'), b = encryptField('same')
    expect(a).not.toBe(b)
    expect(a.startsWith('v1.')).toBe(true)
  })
  it('rejects tampering and unknown versions', () => {
    const enc = encryptField('Sunita Devi')
    const body = Buffer.from(enc.slice(3), 'base64url')
    body[body.length - 1] ^= 1
    expect(() => decryptField('v1.' + body.toString('base64url'))).toThrow()
    expect(() => decryptField('v9.' + enc.slice(3))).toThrow()
  })
  it('refuses an authentication tag cut short (Semgrep gcm-no-tag-length)', () => {
    const { bytes, dekWrapped } = encryptBytes(Buffer.alloc(0)) // IV 12 + tag 16, no ciphertext
    expect(decryptBytes(bytes, dekWrapped).length).toBe(0)
    expect(() => decryptBytes(bytes.subarray(0, 16), dekWrapped)).toThrow() // the real tag's first 4 bytes only
  })
  it('round-trips bytes', () => {
    const plain = randomBytes(5000)
    const { bytes, dekWrapped } = encryptBytes(plain)
    expect(bytes.equals(plain)).toBe(false)
    expect(decryptBytes(bytes, dekWrapped).equals(plain)).toBe(true)
  })
  it('fails with a different master key', () => {
    const enc = encryptField('x')
    const saved = process.env.APP_MASTER_KEY
    process.env.APP_MASTER_KEY = randomBytes(32).toString('base64')
    expect(() => decryptField(enc)).toThrow()
    process.env.APP_MASTER_KEY = saved
  })
})

describe('blind indexes and phones', () => {
  it('hmac normalises case and whitespace', () => {
    expect(hmac('  Sunita   DEVI ')).toBe(hmac('sunita devi'))
    expect(hmac('a')).not.toBe(hmac('b'))
  })
  it('normalises Indian numbers to one form', () => {
    for (const p of ['9876543210', '+91 98765 43210', '09876543210', '+91-98765-43210']) expect(normalizePhone(p)).toBe('+919876543210')
    expect(normalizePhone('12345')).toBeNull()
    expect(phoneHmac('98765 43210')).toBe(phoneHmac('+919876543210'))
  })
  it('masks phones', () => {
    expect(maskPhone('9876543210')).toBe('+91 ••••• •3210')
  })
})

describe('tokens, hashes, passwords', () => {
  it('base32 matches RFC 4648 and round-trips', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
    const b = randomBytes(20)
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true)
  })
  it('randomToken has the requested entropy', () => {
    expect(randomToken(16, 'base32')).toMatch(/^[A-Z2-7]{26}$/)
    expect(Buffer.from(randomToken(32), 'base64url').length).toBe(32)
    expect(randomToken(16)).not.toBe(randomToken(16))
  })
  it('sha256Hex matches a known vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('timingSafeEqualStr', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true)
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false)
  })
  it('scrypt hash verifies only the right password', async () => {
    const h = await hashPassword('Demo@2026')
    expect(h.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('Demo@2026', h)).toBe(true)
    expect(await verifyPassword('demo@2026', h)).toBe(false)
    expect(await verifyPassword('x', 'garbage')).toBe(false)
  })
})

describe('Ed25519', () => {
  it('signs and verifies with key id; detects tampering', () => {
    const msg = Buffer.from('{"snapshot":1}')
    const { signature, keyId } = signEd25519(msg)
    expect(keyId).toBe('k-test')
    expect(verifyEd25519(msg, signature, keyId)).toBe(true)
    expect(verifyEd25519(Buffer.from('{"snapshot":2}'), signature, keyId)).toBe(false)
    expect(verifyEd25519(msg, signature, 'k-other')).toBe(false)
    expect(publicKeys()[0]).toMatchObject({ keyId: 'k-test', alg: 'Ed25519', status: 'active' })
  })
  it('still verifies signatures made with a retired key, by its own key id', () => {
    const msg = Buffer.from('{"snapshot":"sealed before rotation"}')
    const old = sign(null, msg, OLD.privateKey).toString('base64url')
    expect(verifyEd25519(msg, old, 'k-old')).toBe(true)
    expect(verifyEd25519(msg, old, 'k-test')).toBe(false) // wrong key id
    expect(verifyEd25519(Buffer.from('{"snapshot":"tampered"}'), old, 'k-old')).toBe(false)
    expect(publicKeys().map((k) => [k.keyId, k.status])).toEqual([['k-test', 'active'], ['k-old', 'retired']])
  })
})

describe('files are compressed before they are encrypted (lossless)', () => {
  const text = Buffer.from('Haemoglobin 11.2 g/dL\tPlatelets 2.1 lakh\n'.repeat(2000)) // compresses well (like DICOM pixels or text)
  it('a compressible file is stored smaller, marked, and comes back byte for byte', () => {
    const e = encryptBytes(text)
    expect(e.dekWrapped.startsWith('z.v1.')).toBe(true)
    expect(e.bytes.length).toBeLessThan(text.length / 10)
    expect(decryptBytes(e.bytes, e.dekWrapped).equals(text)).toBe(true)
    expect(sha256Hex(decryptBytes(e.bytes, e.dekWrapped))).toBe(sha256Hex(text))
  })
  it('a packed file (random bytes, like a JPEG) is stored as it came: no marker, no growth', () => {
    const jpeg = randomBytes(200_000)
    const e = encryptBytes(jpeg)
    expect(e.dekWrapped.startsWith('v1.')).toBe(true)
    expect(e.bytes.length).toBe(jpeg.length + 28) // IV + tag only
    expect(decryptBytes(e.bytes, e.dekWrapped).equals(jpeg)).toBe(true)
  })
  it('a large file whose start does not compress is not tried (a scan study); one whose start compresses is', () => {
    const study = Buffer.concat([randomBytes(256 * 1024), Buffer.alloc(768 * 1024)]) // packed start, compressible tail
    const a = encryptBytes(study)
    expect(a.dekWrapped.startsWith('v1.')).toBe(true)
    expect(decryptBytes(a.bytes, a.dekWrapped).equals(study)).toBe(true)
    const pdf = Buffer.concat([Buffer.alloc(300 * 1024, 'a'), randomBytes(300 * 1024)]) // compressible start: tried, kept (half saved)
    const b = encryptBytes(pdf)
    expect(b.dekWrapped.startsWith('z.v1.')).toBe(true)
    expect(decryptBytes(b.bytes, b.dekWrapped).equals(pdf)).toBe(true)
  })
  it('an empty file, and a file stored before compression, still read back', () => {
    const empty = encryptBytes(Buffer.alloc(0))
    expect(decryptBytes(empty.bytes, empty.dekWrapped).length).toBe(0)
    const before = encryptBytes(randomBytes(64)) // the pre-compression shape: "v1.…", stored as it came
    expect(before.dekWrapped.startsWith('v1.')).toBe(true)
    expect(decryptBytes(before.bytes, before.dekWrapped).length).toBe(64)
  })
  it('a compressed file still fails to decrypt when its stored bytes change', () => {
    const e = encryptBytes(text)
    const bad = Buffer.from(e.bytes)
    bad[bad.length - 20] ^= 1
    expect(() => decryptBytes(bad, e.dekWrapped)).toThrow()
  })
})

