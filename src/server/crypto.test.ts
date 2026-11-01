import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  base32Decode, base32Encode, decryptBytes, decryptField, encryptBytes, encryptField, hashPassword, hmac, maskPhone,
  normalizePhone, phoneHmac, publicKeys, randomToken, sha256Hex, signEd25519, timingSafeEqualStr, verifyEd25519, verifyPassword,
} from './crypto'

beforeAll(() => {
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
    expect(publicKeys()[0]).toMatchObject({ keyId: 'k-test', alg: 'Ed25519' })
  })
})
