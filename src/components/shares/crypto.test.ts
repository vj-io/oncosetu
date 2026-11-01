import { describe, expect, it } from 'vitest'
import { decryptJson, encryptJson, fromB64url, toB64url } from './crypto'

describe('share envelope (AES-256-GCM, key in the fragment)', () => {
  it('round-trips; the key is 256 bits and is not part of what the server stores', async () => {
    const value = { heading: 'Document index, not a clinical summary', n: 3, hi: 'दस्तावेज़ सूची' }
    const e = await encryptJson(value)
    expect(fromB64url(e.key)).toHaveLength(32)
    expect(fromB64url(e.iv)).toHaveLength(12)
    expect(e.ciphertext).not.toContain(e.key)
    expect(await decryptJson(e.key, e.ciphertext, e.iv)).toEqual(value)
  })

  it('a wrong key or an altered ciphertext fails', async () => {
    const e = await encryptJson({ a: 1 })
    const other = await encryptJson({ a: 1 })
    await expect(decryptJson(other.key, e.ciphertext, e.iv)).rejects.toThrow()
    const ct = fromB64url(e.ciphertext); ct[0] ^= 1
    await expect(decryptJson(e.key, toB64url(ct), e.iv)).rejects.toThrow()
  })

  it('base64url handles large buffers', () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256)
    expect(fromB64url(toB64url(big))).toEqual(big)
  })
})
