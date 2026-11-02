// Decryption is refused unless the consent artefact is GRANTED, unexpired, for this patient, these HI types and this range.
import { describe, expect, it, vi } from 'vitest'
import * as crypto from './crypto'
import { bundleWithinArtefact, checkArtefact, openPush, type GateExpect, type StoredArtefact } from './gate'
import { entryChecksum, type DataPush } from './transport'

const NOW = new Date('2026-11-02T06:00:00.000Z')
const artefact: StoredArtefact = {
  consentId: 'c-1', status: 'GRANTED', patientHmac: 'h-patient', hipId: 'HIP', hiTypes: ['DiagnosticReport', 'Prescription'],
  dateRange: { from: '2025-01-01T00:00:00.000Z', to: '2026-11-01T23:59:59.000Z' }, dataEraseAt: '2026-12-02T00:00:00.000Z', grantedAt: NOW.toISOString(),
}
const expectOk = { patientHmac: 'h-patient', hiTypes: ['DiagnosticReport'], dateRange: { from: '2025-06-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }, now: NOW }

function push(plain = '{"resourceType":"Bundle"}') {
  const hiu = crypto.ephemeral(new Date('2027-01-01')), hip = crypto.ephemeral(new Date('2027-01-01'))
  const p: DataPush = {
    transactionId: 't-1', pageNumber: 1, pageCount: 1, keyMaterial: hip.keyMaterial,
    entries: [{ content: crypto.encryptEntry(plain, hip, hiu.keyMaterial, NOW), media: 'application/fhir+json', checksum: entryChecksum(plain), careContextReference: 'CC-1' }],
  }
  return { hiu, p }
}

describe('consent gate before decryption', () => {
  it('passes a GRANTED, unexpired artefact for this patient, HI types and range', () => {
    expect(checkArtefact(artefact, expectOk)).toEqual({ ok: true })
  })

  it.each([
    ['no_artefact', null, expectOk],
    ['not_granted', { ...artefact, status: 'REVOKED' }, expectOk],
    ['not_granted', { ...artefact, status: 'DENIED' }, expectOk],
    ['not_granted', { ...artefact, status: 'EXPIRED' }, expectOk],
    ['expired', { ...artefact, dataEraseAt: '2026-11-02T05:59:59.000Z' }, expectOk],
    ['wrong_patient', artefact, { ...expectOk, patientHmac: 'h-someone-else' }],
    ['wrong_patient', artefact, { ...expectOk, patientHmac: null }],
    ['hi_type_not_granted', artefact, { ...expectOk, hiTypes: ['DiagnosticReport', 'DischargeSummary'] }],
    ['hi_type_not_granted', artefact, { ...expectOk, hiTypes: [] }],
    ['date_range_not_granted', artefact, { ...expectOk, dateRange: { from: '2024-12-31T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' } }],
    ['date_range_not_granted', artefact, { ...expectOk, dateRange: { from: '2025-06-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' } }],
  ] as const)('refuses: %s', (reason, a, e) => {
    expect(checkArtefact(a as StoredArtefact | null, e as GateExpect)).toEqual({ ok: false, reason })
  })

  it('openPush decrypts only after the gate passes; a refusal never calls decrypt', () => {
    const { hiu, p } = push()
    const spy = vi.spyOn(crypto, 'decryptEntry')
    expect(openPush({ ...artefact, status: 'REVOKED' }, expectOk, p, hiu)).toEqual({ ok: false, reason: 'not_granted' })
    expect(openPush(artefact, { ...expectOk, patientHmac: 'other' }, p, hiu)).toEqual({ ok: false, reason: 'wrong_patient' })
    expect(openPush({ ...artefact, dataEraseAt: '2026-01-01T00:00:00.000Z' }, expectOk, p, hiu)).toEqual({ ok: false, reason: 'expired' })
    expect(spy).not.toHaveBeenCalled()
    const ok = openPush(artefact, expectOk, p, hiu)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(ok.ok && ok.entries[0].plaintext.toString()).toBe('{"resourceType":"Bundle"}')
    spy.mockRestore()
  })

  it('a tampered entry refuses the whole push; a wrong checksum too', () => {
    const { hiu, p } = push()
    const b = Buffer.from(p.entries[0].content, 'base64')
    b[3] ^= 0xff
    expect(openPush(artefact, expectOk, { ...p, entries: [p.entries[0], { ...p.entries[0], content: b.toString('base64') }] }, hiu)).toEqual({ ok: false, reason: 'decrypt_failed' })
    expect(openPush(artefact, expectOk, { ...p, entries: [{ ...p.entries[0], checksum: '0'.repeat(32) }] }, hiu)).toEqual({ ok: false, reason: 'checksum_mismatch' })
  })

  it('each decrypted bundle must be of a granted HI type and dated inside the artefact range', () => {
    expect(bundleWithinArtefact(artefact, { hiType: 'Prescription', date: '2026-04-02' })).toBe(true)
    expect(bundleWithinArtefact(artefact, { hiType: 'DischargeSummary', date: '2026-04-02' })).toBe(false)
    expect(bundleWithinArtefact(artefact, { hiType: 'Prescription', date: '2024-04-02' })).toBe(false)
    expect(bundleWithinArtefact(artefact, { hiType: 'Prescription', date: null })).toBe(false)
  })
})
