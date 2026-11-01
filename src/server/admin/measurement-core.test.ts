import { describe, expect, it } from 'vitest'
import { MEASURE_CSV_HEADER, measurementCsv, summariseMeasurement, validateMeasurement, weekStart, type MeasureRow } from './measurement-core'
import { csvCell, toCsv } from './csv'

const row = (o: Partial<MeasureRow> = {}): MeasureRow => ({
  phase: 'baseline', consultationDate: '2026-11-04', firstVisit: true, missingRecordPresent: false, missingRecordCount: 0, missingTypes: [],
  impact: 'none', repeatTestOrdered: false, repeatTestReason: null, prepMinutes: null, clinicianId: '0193a000-0000-7000-8000-00000000c001', ...o,
})

describe('measurement CSV is anonymised', () => {
  it('contains only whitelisted columns and no ids, names, phones or dates of birth', () => {
    // A caller passing a fuller object (PHI-bearing extras) must not leak: only whitelisted fields are read.
    const leaky = { ...row({ missingRecordPresent: true, missingRecordCount: 2, missingTypes: ['pathology_report'] }),
      patientName: 'Sunita Devi', phone: '+919876543210', dob: '1962-03-04', encounterId: '0193a000-0000-7000-8000-00000000e001' } as MeasureRow
    const csv = measurementCsv([leaky, row({ clinicianId: 'other' })])
    const [header] = csv.split('\r\n')
    expect(header.split(',')).toEqual([...MEASURE_CSV_HEADER])
    for (const bad of ['Sunita', 'Devi', '9876543210', '1962', '0193a000', 'e001', 'patient', 'name', 'phone', 'dob', 'encounter']) {
      expect(csv.toLowerCase()).not.toContain(bad.toLowerCase())
    }
  })
  it('replaces exact dates by the ISO week start and clinicians by codes', () => {
    expect(weekStart('2026-11-04')).toBe('2026-11-02') // Wednesday → Monday
    expect(weekStart('2026-11-08')).toBe('2026-11-02') // Sunday
    const lines = measurementCsv([row({ clinicianId: 'zzz' }), row({ clinicianId: 'aaa', consultationDate: '2026-11-11' })]).trim().split('\r\n')
    expect(lines[1]).toContain(',2026-11-02,')
    expect(lines[1].endsWith(',C2')).toBe(true) // 'zzz' sorts after 'aaa'
    expect(lines[2].endsWith(',C1')).toBe(true)
    expect(lines.join('')).not.toMatch(/2026-11-04|2026-11-11/)
  })
})

describe('validateMeasurement', () => {
  const v = (o: Partial<MeasureRow>) => validateMeasurement({ ...row(o) })
  it('accepts consistent forms', () => {
    expect(v({})).toEqual([])
    expect(v({ missingRecordPresent: true, missingRecordCount: 1, missingTypes: ['pathology_report'], impact: 'repeat_test_ordered', repeatTestOrdered: true, repeatTestReason: 'unavailable' })).toEqual([])
  })
  it('rejects contradictory answers', () => {
    expect(v({ missingRecordPresent: false, missingRecordCount: 2 })).not.toEqual([])
    expect(v({ missingRecordPresent: true, missingRecordCount: 0 })).not.toEqual([])
    expect(v({ missingRecordPresent: true, missingRecordCount: 1, missingTypes: ['not_a_type'] })).not.toEqual([])
    expect(v({ repeatTestOrdered: true, repeatTestReason: null })).not.toEqual([])
    expect(v({ repeatTestReason: 'quality' })).not.toEqual([])
    expect(v({ impact: 'repeat_test_ordered' })).not.toEqual([])
  })
})

describe('summariseMeasurement', () => {
  it('uses first visits as the missing-record denominator and reports n with every rate', () => {
    const s = summariseMeasurement([
      row({ missingRecordPresent: true, missingRecordCount: 1, missingTypes: ['pathology_report'], prepMinutes: 10 }),
      row({ firstVisit: false, missingRecordPresent: true, missingRecordCount: 1, missingTypes: ['imaging_report'] }),
      row({ prepMinutes: 20, repeatTestOrdered: true, repeatTestReason: 'quality', impact: 'repeat_test_ordered' }),
      row({ phase: 'live' }),
    ])
    const base = s.phases.find((p) => p.phase === 'baseline')!
    expect(base).toMatchObject({ n: 3, missingRate: { num: 1, den: 2 }, repeatRate: { num: 1, den: 3 }, prepMedian: 15, prepN: 2 })
    expect(s.phases.find((p) => p.phase === 'shadow')).toMatchObject({ n: 0, missingRate: { den: 0 }, prepMedian: null })
    expect(s.typeCounts).toEqual([{ docType: 'imaging_report', n: 1 }, { docType: 'pathology_report', n: 1 }])
    expect(s.reasons.find((r) => r.reason === 'quality')?.n).toBe(1)
  })
})

describe('csv', () => {
  it('quotes separators and neutralises spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell(null)).toBe('')
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('a,b\r\n1,x\r\n')
  })
})
