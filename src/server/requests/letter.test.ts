import { describe, expect, it } from 'vitest'
import { lintText, type Ruleset } from '@/core/copy'
import { buildLetter, DEFAULT_REQUEST_DOCS, letterText, type LetterInput } from './letter'

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

  it('not cleared: Setu Records brand, neutral labels, an institution name that discloses becomes a blank line', () => {
    const l = buildLetter(input)
    expect(l.brand).toBe('Setu Records')
    expect(l.to.institution).toBeNull()
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
