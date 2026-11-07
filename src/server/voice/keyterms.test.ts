import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMULARY } from '@/core/formulary'
import { buildKeyterms, medicineName } from './keyterms'

describe('medicineName', () => {
  it('keeps the spoken name and drops form, numbering and dose', () => {
    expect(medicineName('Tab. Capecitabine 500 mg BD')).toBe('Capecitabine')
    expect(medicineName('2) Cap Ondansetron 4mg')).toBe('Ondansetron')
    expect(medicineName('Inj. Zoledronic acid 4 mg')).toBe('Zoledronic acid')
    expect(medicineName('Letrozole')).toBe('Letrozole')
    expect(medicineName('500 mg')).toBeNull()
  })
})

describe('buildKeyterms', () => {
  it('puts the patient’s own medicines and hospitals before the formulary, deduplicated, at most 50', () => {
    const t = buildKeyterms({ medicines: ['Tab. Capecitabine 500 mg', 'Tab Capecitabine'], institutions: ['Tata Memorial Hospital'] })
    expect(t.slice(0, 2)).toEqual(['Capecitabine', 'Tata Memorial Hospital'])
    expect(t.filter((x) => x.toLowerCase() === 'capecitabine')).toHaveLength(1)
    expect(t).toHaveLength(50)
    expect(DEFAULT_FORMULARY.length).toBeGreaterThanOrEqual(50)
  })
})
