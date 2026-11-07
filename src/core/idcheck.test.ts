import { describe, expect, it } from 'vitest'
import { maskId, validateLast4 } from './idcheck'

describe('validateLast4', () => {
  it('accepts exactly four digits for Aadhaar and masks them', () => {
    expect(validateLast4('aadhaar', '1234')).toEqual({ ok: true, last4: '1234' })
    expect(maskId('aadhaar', '1234')).toBe('XXXX XXXX 1234')
  })
  it('rejects a full 12-digit Aadhaar number in any spelling, without keeping it', () => {
    for (const v of ['123456789012', '1234 5678 9012', '1234-5678-9012']) expect(validateLast4('aadhaar', v)).toEqual({ ok: false, code: 'full_number' })
  })
  it('rejects a full ABHA number (14 digits) and short or non-digit input', () => {
    expect(validateLast4('abha', '12-3456-7890-1234')).toEqual({ ok: false, code: 'full_number' })
    expect(validateLast4('aadhaar', '12')).toEqual({ ok: false, code: 'not_four' })
    expect(validateLast4('aadhaar', 'AB12')).toEqual({ ok: false, code: 'bad_chars' })
  })
  it('allows letters for PAN, voter ID, passport and licence', () => {
    expect(validateLast4('pan', '12af')).toEqual({ ok: true, last4: '12AF' })
    expect(validateLast4('pan', 'ABCDE1234F')).toEqual({ ok: false, code: 'full_number' })
    expect(maskId('pan', '12AF')).toBe('•••• 12AF')
  })
})
