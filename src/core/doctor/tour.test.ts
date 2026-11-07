import { describe, expect, it } from 'vitest'
import { clampStep, parseTourState, TOUR_LENGTH, tourSteps, usableSteps } from './tour'

const S = '11111111-1111-1111-1111-111111111111'
const K = '22222222-2222-2222-2222-222222222222'

describe('tour', () => {
  it('has six steps over Sunita then Khan', () => {
    const s = tourSteps({ sunita: S, khan: K })
    expect(s).toHaveLength(TOUR_LENGTH)
    expect(s.map((x) => x.patient)).toEqual(['sunita', 'sunita', 'sunita', 'sunita', 'khan', 'khan'])
    expect(s[0].path).toBe(`/patients/${S}/documents`)
    expect(s[5].path).toBe(`/patients/${K}/ledger`)
  })
  it('skips steps for a patient that is not found', () => {
    expect(usableSteps({ sunita: null, khan: K })).toHaveLength(2)
    expect(usableSteps({ sunita: null, khan: null })).toHaveLength(0)
  })
  it('writes each step in one plain sentence or two, without jargon', () => {
    for (const st of tourSteps({ sunita: S, khan: K })) {
      expect(st.text.length).toBeLessThan(260)
      expect(st.text).not.toMatch(/hash|RLS|snapshot|evidence gate|shadow|SHA/i)
    }
  })
  it('clamps the step', () => {
    expect(clampStep(-3, 6)).toBe(0)
    expect(clampStep(99, 6)).toBe(5)
    expect(clampStep(NaN, 6)).toBe(0)
  })
  it('parses saved state safely', () => {
    expect(parseTourState(null)).toBeNull()
    expect(parseTourState('not json')).toBeNull()
    expect(parseTourState('{"active":true}')).toBeNull()
    const ok = parseTourState(JSON.stringify({ active: true, step: 2, patients: { sunita: S, khan: '<script>' } }))
    expect(ok).toEqual({ active: true, step: 2, patients: { sunita: S, khan: null } })
  })
})
