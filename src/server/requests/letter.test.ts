import { describe, expect, it } from 'vitest'
import { lintText, type Ruleset } from '@/core/copy'
import { buildLetter, cycleList, DEFAULT_REQUEST_DOCS, letterText, neutralName, type LetterInput } from './letter'

const input: LetterInput = {
  lang: 'en', disclosure: 'not_cleared', requestId: '0193b000-0000-7000-8000-00000000abcd',
  patient: { name: 'Sunita Devi', dob: '1972-05-14' },
  institution: 'Regional Cancer Centre, Jaipur', institutionPatientId: 'UHID 44812',
  documents: DEFAULT_REQUEST_DOCS, dateRange: { from: '2026-03-01', to: '2026-04-30' }, today: '2026-11-02',
}

describe('request letter (FR-REQ-01/02)', () => {
  for (const lang of ['en', 'hi'] as const) {
    for (const disclosure of ['not_cleared', 'unknown', 'cleared'] as const) {
      it(`${lang} / ${disclosure}: no deadline or obligation claims, no care wording${disclosure === 'cleared' ? '' : ', no diagnosis words'}`, () => {
        const text = letterText(buildLetter({ ...input, lang, disclosure }))
        const rules: Ruleset[] = disclosure === 'cleared' ? ['legal', 'radar'] : ['legal', 'radar', 'diagnosis']
        expect(lintText(text, rules)).toEqual([])
        expect(text).toContain('72')
        expect(text).toContain('1.3.2')
      })
    }
  }

  it('not cleared: Setu Records brand, neutral labels, a diagnosis word is dropped from the hospital name', () => {
    const l = buildLetter(input)
    expect(l.brand).toBe('Setu Records')
    expect(l.to.institution).toBe('Regional Centre, Jaipur')
    expect(l.documents).toEqual(['Hospital discharge summary', 'Indoor (in-patient) case records', 'Laboratory report (tissue)', 'Scan report'])
    expect(buildLetter({ ...input, institution: 'City Hospital, Jaipur' }).to.institution).toBe('City Hospital, Jaipur')
    expect(buildLetter({ ...input, disclosure: 'cleared' }).brand).toBe('OncoSetu')
  })

  it('matches the reviewed text (snapshot)', () => {
    expect(letterText(buildLetter({ ...input, institution: 'City Hospital, Jaipur' }))).toMatchSnapshot()
    expect(letterText(buildLetter({ ...input, institution: 'City Hospital, Jaipur', lang: 'hi' }))).toMatchSnapshot()
  })
})

describe('request catalogue (letter, escalation sheet, reminders)', () => {
  it('makes no deadline or obligation claims in either language', async () => {
    const { en, hi } = await import('@/i18n/requests')
    const hits = [...Object.entries(en), ...Object.entries(hi)].flatMap(([k, v]) => lintText(v, ['legal']).map((h) => `${k}: ${h.match}`))
    expect(hits).toEqual([])
  })
})

describe('neutralName and cycles', () => {
  it('keeps the hospital name and drops only the diagnosis word', () => {
    expect(neutralName('Kasturi Day-Care Chemotherapy Unit', 'unknown')).toBe('Kasturi Day-Care Unit')
    expect(neutralName('Kasturi Day-Care Chemotherapy Unit', 'cleared')).toBe('Kasturi Day-Care Chemotherapy Unit')
    expect(neutralName('City Hospital', 'unknown')).toBe('City Hospital')
    expect(neutralName('Cancer', 'unknown')).toBeNull()
    expect(neutralName('', 'unknown')).toBeNull()
  })
  it('lists cycles in words', () => {
    expect(cycleList([3, 1, 2], 'en')).toBe('1, 2 and 3')
    expect(cycleList([2], 'en')).toBe('2')
    expect(cycleList([], 'en')).toBe('')
  })
  it('names the cycles on the day-care line, neutrally', () => {
    const l = buildLetter({ ...input, institution: 'Kasturi Day-Care Chemotherapy Unit', documents: ['chemo_daycare_record'], cycles: [1, 2, 3] })
    expect(l.to.institution).toBe('Kasturi Day-Care Unit')
    expect(l.documents).toEqual([expect.stringMatching(/cycles 1, 2 and 3$/)])
    expect(letterText(l)).not.toMatch(/chemo/i)
  })
})

describe('the hospital name on the patient requests card', () => {
  it('keeps the safe part of the name for an undisclosed patient, like the letter', async () => {
    const { patientInstitution } = await import('./letter')
    expect(patientInstitution('Kasturi Day-Care Chemotherapy Unit', 'not_cleared')).toBe('Kasturi Day-Care Unit')
    expect(patientInstitution('Kasturi Day-Care Chemotherapy Unit', 'unknown')).toBe('Kasturi Day-Care Unit')
    expect(patientInstitution('Kasturi Day-Care Chemotherapy Unit', 'cleared')).toBe('Kasturi Day-Care Chemotherapy Unit')
    expect(patientInstitution('Triveni Multispeciality Hospital', 'not_cleared')).toBe('Triveni Multispeciality Hospital')
  })
  it('says "the hospital" only when nothing safe is left', async () => {
    const { patientInstitution } = await import('./letter')
    expect(patientInstitution('Cancer Chemo', 'not_cleared')).toBe('the hospital')
  })
})
