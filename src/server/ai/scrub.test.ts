import { describe, expect, it } from 'vitest'
import { makeScrubber } from './scrub'

const page = `KOKILABEN HOSPITAL   UHID: KH-0042-1187
Patient Name: Mrs. SUNITA RAMESH DESHMUKH   Age/Sex: 51 Y / F   DOB: 14/08/1974
Ph: +91 98765 43210, alt 09876543210   Email: sunita.d@example.com   ABHA: 91-2345-6789-0123   Aadhaar 1234 5678 9012
Clinical: Deshmukh Sunita, known case of carcinoma left breast (ER+). Mammogram on 12/02/2025: 2.3 x 1.8 cm mass.
Hb 11.2 g/dL, platelets 2.45 lakh/cmm. Report 1001 of 2025. Blood test advised. Ref: Dr. Meera Iyer.`
const id = { name: 'Sunita Ramesh Deshmukh', aliases: ['Sunita Deshmukh'], dob: '1974-08-14', mrns: ['KH-0042-1187'] }

describe('identifier scrubbing before an AI call', () => {
  it('removes the name (any case, any order, first name alone), hospital number, birth date, phones, e-mail, ABHA and Aadhaar', () => {
    const s = makeScrubber(id).scrub(page)
    for (const leak of ['SUNITA', 'Sunita', 'DESHMUKH', 'Deshmukh', 'RAMESH', 'KH-0042-1187', '14/08/1974', '98765 43210', '09876543210',
      'sunita.d@example.com', '91-2345-6789-0123', '1234 5678 9012']) expect(s).not.toContain(leak)
    expect(s).toMatch(/\[PATIENT_NAME_\d\]/)
    expect(s).toMatch(/\[PATIENT_ID_1\]/)
    expect(s).toMatch(/\[DOB_1\]/)
  })

  it('keeps the clinical content: measurements, lab values, other dates, the doctor, ordinary words', () => {
    const s = makeScrubber(id).scrub(page)
    for (const keep of ['carcinoma left breast (ER+)', '12/02/2025', '2.3 x 1.8 cm', 'Hb 11.2 g/dL', '2.45 lakh/cmm', 'Report 1001 of 2025', 'Blood test advised', 'Dr. Meera Iyer', '51 Y / F'])
      expect(s).toContain(keep)
  })

  it('puts the original text back into the answer, exactly, wherever a placeholder appears', () => {
    const sc = makeScrubber(id)
    const s = sc.scrub(page)
    expect(sc.restore(s)).toBe(page)
    const quote = s.split('\n')[3].slice(0, 60) // a quote the model copied from the scrubbed page
    const answer = { items: [{ quote, fields: { note: 'seen by [PATIENT_NAME_1]' } }], header: { name: '[PATIENT_NAME_1] [PATIENT_NAME_3]' } }
    const back = sc.restore(answer)
    expect(page).toContain(back.items[0].quote)
    expect(back.header.name).not.toMatch(/\[/)
  })

  it('does not treat words of a de-identified or test name as names ("Test Patient A")', () => {
    const s = makeScrubber({ name: 'Test Patient A', aliases: [], dob: null, mrns: [] }).scrub('Blood test advised. Patient tolerated the procedure.')
    expect(s).toBe('Blood test advised. Patient tolerated the procedure.')
  })
})
