import { describe, expect, it } from 'vitest'
import { RADAR_RULES } from '@/core/radar/rules'
import { neededFields, ruleTitle, sampleWording, windowText } from './rule-text'

describe('rule text for administrators', () => {
  it('turns a window into plain words', () => {
    expect(windowText([-3650, 0])).toBe('From 10 years before to the day itself')
    expect(windowText([0, 30])).toBe('From the day itself to 30 days after')
    expect(windowText([-1, 1])).toBe('From 1 day before to 1 day after')
  })
  it('fills placeholders with a sample', () => {
    expect(sampleWording('Seen on {event_date} ({source_label}).')).toBe('Seen on 12 Oct 2026 (discharge summary).')
  })
  it('names the needed fields', () => {
    expect(neededFields(['procedure_text', 'event_date'])).toBe('the procedure and a date')
  })
  it('every rule gets a title with no underscore, id or placeholder', () => {
    for (const r of RADAR_RULES) {
      expect(ruleTitle(r)).not.toMatch(/[_{}]|RAD-/)
      expect(sampleWording(r.wording.en)).not.toMatch(/[{}]/)
      expect(sampleWording(r.wording.hi)).not.toMatch(/[{}]/)
    }
  })
})
