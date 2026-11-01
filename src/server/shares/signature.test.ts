// S2c: the share viewer trusts a payload only with a valid server signature. Server signs, browser code verifies
// (WebCrypto Ed25519, or the digest-only fallback endpoint), any edit by the link's creator breaks it.
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { verifySharePayload } from '@/components/shares/crypto'
import { publicKeys } from '../crypto'
import { shareDigestValid, signSharePayload } from './shares'

beforeAll(() => {
  process.env.HMAC_KEY = randomBytes(32).toString('base64')
  const { privateKey } = generateKeyPairSync('ed25519')
  process.env.SIGNING_KEY_ED25519 = Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()).toString('base64')
  process.env.SIGNING_KEY_ID = 'k-test'
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** Same-origin endpoints the viewer calls, answered by the real server functions. */
function serve() {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(url)
    if (url === '/api/keys') return Response.json({ keys: publicKeys() })
    if (url === '/api/shares/verify-payload') {
      const b = JSON.parse(String(init!.body))
      return Response.json({ valid: shareDigestValid(b.digest, b) })
    }
    return new Response(null, { status: 404 })
  })
  return calls
}

const body = {
  v: 1, kind: 'document_index', brand: 'Setu Records', scope: 'index', asOf: '2026-10-10T06:00:00.000Z', issuedAt: '2026-11-02T05:00:00.000Z',
  items: [{ label: { en: 'Hospital report', hi: 'अस्पताल रिपोर्ट' }, date: '2026-10-01', precision: 'day', institution: null, source: { documentId: null, label: null, page: 1 }, verification: 'unverified' }],
  seal: { snapshotId: '0190a3c2-0000-7000-8000-000000000001', sha256: 'a'.repeat(64), verifyPath: '/verify/0190a3c2-0000-7000-8000-000000000001' },
  snapshotId: '0190a3c2-0000-7000-8000-000000000001',
}
// What the viewer gets: the signed payload after the browser's JSON encrypt/decrypt round trip.
const delivered = () => JSON.parse(JSON.stringify(signSharePayload(body))) as Record<string, unknown> & typeof body

describe('share payload signature (S2c)', () => {
  it('a server-built payload verifies with WebCrypto Ed25519 against /api/keys', async () => {
    const calls = serve()
    expect(await verifySharePayload(delivered())).toBe(true)
    expect(calls).toEqual(['/api/keys'])
  })

  it('any change by the creator — a chip, the verify link, the brand — fails', async () => {
    serve()
    const chip = delivered(); chip.items[0].verification = 'clinician'
    const link = delivered(); link.seal.verifyPath = 'javascript:alert(1)'
    const brand = delivered(); brand.brand = 'OncoSetu'
    for (const p of [chip, link, brand]) expect(await verifySharePayload(p)).toBe(false)
  })

  it('no signature, or an unknown key id, is not verified', async () => {
    serve()
    const unsigned: Record<string, unknown> = delivered(); delete unsigned.sig
    const otherKey = delivered(); (otherKey.sig as { keyId: string }).keyId = 'k-other'
    expect(await verifySharePayload(unsigned)).toBe(false)
    expect(await verifySharePayload(otherKey)).toBe(false)
  })

  it('without WebCrypto Ed25519 it falls back to the endpoint, sending only the digest', async () => {
    const calls = serve()
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new DOMException('Ed25519', 'NotSupportedError'))
    expect(await verifySharePayload(delivered())).toBe(true)
    const tampered = delivered(); tampered.items[0].verification = 'clinician'
    expect(await verifySharePayload(tampered)).toBe(false)
    expect(calls.filter((c) => c === '/api/shares/verify-payload')).toHaveLength(2)
  })
})
