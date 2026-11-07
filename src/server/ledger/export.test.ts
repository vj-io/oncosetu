// FR-PAS-05: a downloaded sealed snapshot checks out offline against the published public keys; one changed byte does not.
import { generateKeyPairSync } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildSnapshot } from '@/core/ledger'
import { publicKeys } from '../crypto'
import { snapshotFile, verifySnapshotFile, type PublicKey, type SnapshotFile } from './export'
import { sealBytes } from './seal'

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('ed25519')
  process.env.SIGNING_KEY_ED25519 = Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()).toString('base64')
  process.env.SIGNING_KEY_ID = 'k-test'
})

const AT = '2026-11-02T06:00:00.000Z'
/** The file as GET /api/snapshots/[id] serves it: the stored row of a real seal, pretty-printed. */
function download(): string {
  const snapshot = buildSnapshot({
    patientId: '00000000-0000-7000-8000-000000000001', documents: [], statements: [], missing: [],
    events: [{
      id: '00000000-0000-7000-8000-000000000002', eventType: 'lab_report_documented', fields: { test_name: 'CBC — रक्त जाँच' }, eventDate: '2026-10-01',
      datePrecision: 'day', documentDate: null, receivedAt: '2026-10-02T05:00:00.000Z', documentId: null, sourceType: 'external_document',
      extractionMethod: 'text_layer', verificationStatus: 'verified_matches_source', flags: [], version: 1, supersedesId: null, evidence: [],
    }],
  }, AT)
  const s = sealBytes(snapshot)
  return JSON.stringify(snapshotFile({ id: 'snap-1', seq: 0, sealedAt: new Date(AT), sha256: s.sha256, keyId: s.keyId, signature: s.signature, canonicalJson: s.json }), null, 2)
}
const check = (text: string, keys: PublicKey[] = publicKeys()) => verifySnapshotFile(JSON.parse(text) as SnapshotFile, keys)

describe('offline snapshot check (FR-PAS-05)', () => {
  it('a downloaded snapshot verifies against the published keys', () => {
    const text = download()
    expect(check(text)).toMatchObject({ ok: true, hashMatches: true, signatureValid: true, keyFound: true, sha256: JSON.parse(text).sha256 })
  })

  it('one changed byte fails, even with the stored hash updated to match', () => {
    const text = download()
    const i = text.indexOf('CBC')
    const tampered = text.slice(0, i) + 'D' + text.slice(i + 1)
    expect(check(tampered)).toMatchObject({ ok: false, hashMatches: false, signatureValid: false })
    const rehashed = JSON.stringify({ ...JSON.parse(tampered), sha256: check(tampered).sha256 })
    expect(check(rehashed)).toMatchObject({ ok: false, hashMatches: true, signatureValid: false })
  })

  it('a key id that is not in the key list is not verified', () => {
    expect(check(download(), [])).toMatchObject({ ok: false, keyFound: false, signatureValid: false })
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString()
    expect(check(download(), [{ keyId: 'k-test', publicKeyPem: other }])).toMatchObject({ ok: false, keyFound: true, signatureValid: false })
  })
})
