import { constants } from 'node:buffer'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES, MAX_STUDY_BUNDLE_BYTES } from './limits'

describe('stored file limits fit what the database driver can send', () => {
  it('postgres.js sends bytes as one hex string, so the largest stored file (encrypted) must fit in one Node string', async () => {
    // the premise: the driver's bytea (oid 17) encoding is "\x" + 2 hex characters a byte. No connection is opened.
    const sql = postgres('postgres://nobody@localhost:1/none', { max: 1 })
    expect((sql.options.serializers as Record<number, (x: unknown) => string>)[17](Buffer.from([0xab, 0x01]))).toBe('\\xab01')
    await sql.end()
    const encryptionOverhead = 1024 // AES-GCM nonce and tag, generously
    for (const n of [MAX_FILE_BYTES, MAX_STUDY_BUNDLE_BYTES]) expect(2 + 2 * (n + encryptionOverhead)).toBeLessThan(constants.MAX_STRING_LENGTH)
  })
})
