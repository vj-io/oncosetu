// Known-answer vectors for the ABDM/Fidelius derivation (crypto.ts). Derived once from this implementation and frozen.
// Independent anchors: the X25519 keys and shared secret are RFC 7748 §6.1 (Alice = HIU, Bob = HIP); the HKDF output was
// re-computed with Python's hmac/hashlib (RFC 5869 extract+expand) over the same IKM and 20-byte salt.
import { createCipheriv, createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AbdmCryptoError, decryptEntry, deriveSession, encryptEntry, ephemeral, type Ephemeral } from './crypto'

const EXP = new Date('2030-01-01T00:00:00.000Z')
const AT = new Date('2026-11-02T00:00:00.000Z')
const sha = (s: string) => createHash('sha256').update(s).digest()
const hiu = () => ephemeral(EXP, { privateKey: Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a', 'hex'), nonce: sha('oncosetu hiu nonce') })
const hip = () => ephemeral(EXP, { privateKey: Buffer.from('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb', 'hex'), nonce: sha('oncosetu hip nonce') })

const V = {
  hiuKeyValue: 'MCowBQYDK2VuAyEAhSDwCYkwp1R0i33ctD73Wg2/Og0mOBr066SpjqqbTmo=',
  hipKeyValue: 'MCowBQYDK2VuAyEA3p7bfXt9wbTTW2HC7OQ1Nz+DQ8hbeGdNrfx+FG+IK08=',
  hiuNonce: 'qQuaZzEMbuYqWHs99wWSfTOlQ9dBSrr1j8faENsVp3U=',
  hipNonce: 'wZU+xYQqLFSr3fDYXwuFxewHucptMLYbyqqtB+0A5R0=',
  shared: '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742', // RFC 7748 §6.1
  xor: '689ea4a2b52642b281858be5a80e17b8dfa2fa1d2c7a0cee456d771736154268',
  salt: '689ea4a2b52642b281858be5a80e17b8dfa2fa1d', // first 20 bytes of the XOR
  iv: '2c7a0cee456d771736154268', // last 12 bytes of the XOR
  key: '3147f760201a722e7a64abee0a82a5cfca1067596f2d915752775575f798bd3a',
  hipToHiu: { plain: '{"resourceType":"Bundle","type":"document"}', content: 'bx6rMAReVuKkY45PobLbnQ5+OWXd7sP2E/pa0Y4MYWozA4siEGp3jmHfO02Hjg57nt2Izw7VIuWkSXI=' },
  hiuToHip: { plain: 'OncoSetu HIU test vector', content: 'W1K6OiRUV+XnTpNj8aOc1FgcOm7a9smm6PX4NKx1Zidh2x2z2tJsAA==' },
}

describe('ABDM crypto known-answer vectors', () => {
  it('key material uses the documented dhPublicKey structure (X.509 SPKI, base64) and 32-byte nonces', () => {
    const h = hiu()
    expect(h.keyMaterial).toEqual({
      cryptoAlg: 'ECDH', curve: 'Curve25519', nonce: V.hiuNonce,
      dhPublicKey: { expiry: '2030-01-01T00:00:00.000Z', parameters: 'Curve25519/32byte random key', keyValue: V.hiuKeyValue },
    })
    expect(hip().keyMaterial.dhPublicKey.keyValue).toBe(V.hipKeyValue)
    expect(hip().keyMaterial.nonce).toBe(V.hipNonce)
  })

  it('both sides derive the same shared secret, salt (xor[0..20)), IV (xor[20..32)) and HKDF key', () => {
    const a = deriveSession(hiu(), hip().keyMaterial, AT), b = deriveSession(hip(), hiu().keyMaterial, AT)
    for (const s of [a, b]) {
      expect(s.shared.toString('hex')).toBe(V.shared)
      expect(s.xor.toString('hex')).toBe(V.xor)
      expect(s.salt.toString('hex')).toBe(V.salt)
      expect(s.iv.toString('hex')).toBe(V.iv)
      expect(s.key.toString('hex')).toBe(V.key)
    }
  })

  it('content = base64(AES-256-GCM ciphertext || 16-byte tag), no AAD', () => {
    const c = createCipheriv('aes-256-gcm', Buffer.from(V.key, 'hex'), Buffer.from(V.iv, 'hex'))
    const manual = Buffer.concat([c.update(V.hipToHiu.plain), c.final(), c.getAuthTag()]).toString('base64')
    expect(manual).toBe(V.hipToHiu.content)
  })

  it('round trip HIP → HIU and HIU → HIP reproduce the frozen ciphertexts', () => {
    expect(encryptEntry(V.hipToHiu.plain, hip(), hiu().keyMaterial, AT)).toBe(V.hipToHiu.content)
    expect(decryptEntry(V.hipToHiu.content, hiu(), hip().keyMaterial, AT).toString()).toBe(V.hipToHiu.plain)
    expect(encryptEntry(V.hiuToHip.plain, hiu(), hip().keyMaterial, AT)).toBe(V.hiuToHip.content)
    expect(decryptEntry(V.hiuToHip.content, hip(), hiu().keyMaterial, AT).toString()).toBe(V.hiuToHip.plain)
  })

  it('random keys and nonces round-trip', () => {
    const a = ephemeral(EXP), b = ephemeral(EXP)
    const plain = Buffer.from(JSON.stringify({ resourceType: 'Bundle', note: 'सुनीता' }))
    expect(decryptEntry(encryptEntry(plain, a, b.keyMaterial, AT), b, a.keyMaterial, AT)).toEqual(plain)
  })

  const fails = (fn: () => unknown, code: string) => {
    let err: unknown
    try { fn() } catch (e) { err = e }
    expect(err).toBeInstanceOf(AbdmCryptoError)
    expect((err as AbdmCryptoError).code).toBe(code)
  }

  it('a tampered ciphertext or tag fails', () => {
    const blob = Buffer.from(V.hipToHiu.content, 'base64')
    for (const i of [0, 10, blob.length - 1]) {
      const t = Buffer.from(blob)
      t[i] ^= 0x01
      fails(() => decryptEntry(t.toString('base64'), hiu(), hip().keyMaterial, AT), 'decrypt_failed')
    }
    fails(() => decryptEntry(blob.subarray(0, 10).toString('base64'), hiu(), hip().keyMaterial, AT), 'decrypt_failed')
  })

  it('a wrong nonce (either side) or a wrong key fails', () => {
    const otherNonce = (e: Ephemeral) => ({ ...e.keyMaterial, nonce: sha('other').toString('base64') })
    fails(() => decryptEntry(V.hipToHiu.content, hiu(), otherNonce(hip()), AT), 'decrypt_failed')
    const h = hiu()
    fails(() => decryptEntry(V.hipToHiu.content, { ...h, keyMaterial: otherNonce(h) }, hip().keyMaterial, AT), 'decrypt_failed')
    fails(() => decryptEntry(V.hipToHiu.content, ephemeral(EXP), hip().keyMaterial, AT), 'decrypt_failed')
  })

  it('refuses malformed or expired key material', () => {
    const km = hip().keyMaterial
    fails(() => deriveSession(hiu(), { ...km, nonce: Buffer.alloc(16).toString('base64') }, AT), 'bad_nonce')
    fails(() => deriveSession(hiu(), { ...km, dhPublicKey: { ...km.dhPublicKey, keyValue: Buffer.alloc(32).toString('base64') } }, AT), 'bad_key')
    fails(() => deriveSession(hiu(), { ...km, dhPublicKey: { ...km.dhPublicKey, expiry: '2026-01-01T00:00:00Z' } }, AT), 'key_expired')
  })
})
