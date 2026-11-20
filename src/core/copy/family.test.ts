// What a family may be shown of a paper's words: no physician names, no signature footer, no uploaded file name.
import { describe, expect, it } from 'vitest'
import { consentFormLabel, familyDocTitle, familySafeQuote, neutralSkipped, stripPhysician, withoutPhysician } from '.'

const REPORT = [
  'Impression: 2.1 cm lesion in the upper outer quadrant, unchanged from the earlier study.',
  'Reported by: Dr. Anil K. Mehta, MD, DNB (Radiology)',
  'Electronically signed by Dr Mehta on 12/03/2026 10:14',
  'Page 2 of 2',
  '*** End of report ***',
].join('\n')

describe('stripPhysician', () => {
  it('removes the footer lines and keeps the paper\'s own words', () => {
    const out = stripPhysician(REPORT)
    expect(out).toBe('Impression: 2.1 cm lesion in the upper outer quadrant, unchanged from the earlier study.')
    expect(out).not.toMatch(/Mehta|signed|Page 2|End of report/i)
  })
  it('replaces a titled name inside a sentence', () => {
    expect(stripPhysician('Seen by Dr. R. Kapoor and advised review.')).toBe('Seen by [name removed] and advised review.')
    expect(stripPhysician('Prof Rao reviewed the slides')).toBe('[name removed] reviewed the slides')
  })
  it('leaves clinical words and plain text alone', () => {
    expect(stripPhysician('Margins are free of tumour. Doctor visit on 3 March.')).toBe('Margins are free of tumour. Doctor visit on 3 March.')
  })
})

describe('familySafeQuote', () => {
  it('shows the quote without the name, and drops one that was only a signature', () => {
    expect(familySafeQuote(REPORT)).toBe('Impression: 2.1 cm lesion in the upper outer quadrant, unchanged from the earlier study.')
    expect(familySafeQuote('Reported by: Dr. Anil K. Mehta, MD, DNB')).toBeNull()
    expect(familySafeQuote('Dr. Anil Mehta')).toBeNull()
    expect(familySafeQuote(null)).toBeNull()
  })
})

describe('withoutPhysician', () => {
  it('takes a doctor\'s name out of a place name', () => {
    expect(withoutPhysician("Dr. R. Mehta's Cancer Clinic")).toBe('Cancer Clinic')
    expect(withoutPhysician('City Care Hospital')).toBe('City Care Hospital')
    expect(withoutPhysician(null)).toBe('')
  })
})

describe('family lists never show the uploaded file name', () => {
  it('names a paper by its kind and date', () => {
    expect(familyDocTitle('Scan report', '12 Mar 2026')).toBe('Scan report, 12 Mar 2026')
    expect(familyDocTitle('Prescription', null)).toBe('Prescription')
  })
  it('skipped ZIP entries lose their own names', () => {
    const out = neutralSkipped([{ name: 'RAMESH_KUMAR_PET_report.pdf', reason: 'unsupported type' }, { name: 'Dr_Mehta_scan.dcm', reason: 'too large' }])
    expect(JSON.stringify(out)).not.toMatch(/RAMESH|Mehta|\.pdf|\.dcm/)
    expect(out).toEqual([{ name: 'File 1', reason: 'unsupported type' }, { name: 'File 2', reason: 'too large' }])
  })
})

describe('the signed consent form label', () => {
  it('says what it is in every language', () => {
    expect(consentFormLabel('en')).toBe('Signed consent form')
    expect(consentFormLabel('hinglish')).toBe('Signed consent form')
    expect(consentFormLabel('hi')).toBe('हस्ताक्षरित सहमति पत्र')
    expect(consentFormLabel('en', 'withdraw')).toBe('Signed withdrawal of consent')
    for (const l of ['en', 'hi', 'hinglish'] as const) expect(consentFormLabel(l)).not.toMatch(/other|अन्य|doosra/i)
  })
})
