import sharp from 'sharp'
import { extractText, getDocumentProxy } from 'unpdf'
import { describe, expect, it } from 'vitest'
import { buildConsentPdf, checkSigner, FORM_VERSION } from './consent-pdf'

const base = {
  hospital: 'Narmada Regional Cancer Centre', patientName: 'Aarav Kulkarni', signerName: 'Pooja Kulkarni', relation: 'guardian' as const, method: 'typed' as const,
  witnessName: 'Asha Pawar', signedAt: new Date('2026-11-07T10:30:00Z'), noticeVersion: 'dpdp-draft-v1', action: 'grant' as const, language: 'hi',
  purposes: [{ label: 'Care at this hospital', on: true }, { label: 'Second opinion', on: false }],
}
const text = async (pdf: Uint8Array) => (await extractText(await getDocumentProxy(pdf), { mergePages: true })).text.replace(/\s+/g, ' ')

describe('signed consent PDF', () => {
  it('is a PDF that names the signer, relationship, witness, form version, notice version and the draft label', async () => {
    const pdf = await buildConsentPdf(base)
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-')
    const t = await text(pdf)
    for (const part of ['Pooja Kulkarni', 'Parent or legal guardian', 'Asha Pawar', FORM_VERSION, 'dpdp-draft-v1', 'Draft form. Legal review pending', 'Aarav Kulkarni', '[x] Care at this hospital', '[ ] Second opinion', 'Grievance officer: [ ]']) expect(t).toContain(part)
  })
  it('a withdrawal is its own signed document and ticks nothing', async () => {
    const t = await text(await buildConsentPdf({ ...base, action: 'withdraw' }))
    expect(t).toContain('Withdrawal of consent')
    expect(t).not.toContain('[x]')
  })
  it('embeds a drawn signature image', async () => {
    const png = await sharp({ create: { width: 60, height: 20, channels: 3, background: '#000' } }).png().toBuffer()
    const withSig = await buildConsentPdf({ ...base, method: 'drawn', signaturePng: new Uint8Array(png) })
    const without = await buildConsentPdf({ ...base, method: 'drawn', signaturePng: null })
    expect(withSig.length).toBeGreaterThan(without.length)
  })
  it('a patient under 18 is signed for by a guardian, not by themselves or a plain caregiver', () => {
    expect(checkSigner({ minor: true, relation: 'self' })).toMatchObject({ ok: false })
    expect(checkSigner({ minor: true, relation: 'caregiver' })).toMatchObject({ ok: false })
    expect(checkSigner({ minor: true, relation: 'guardian' })).toEqual({ ok: true })
    expect(checkSigner({ minor: false, relation: 'self' })).toEqual({ ok: true })
  })
})
