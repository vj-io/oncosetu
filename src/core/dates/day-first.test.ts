import { describe, expect, it } from 'vitest'
import { parseDate, usesDayFirst } from '.'

describe('usesDayFirst', () => {
  it('is true when one numeric date can only be day first', () => {
    expect(usesDayFirst('Date of Admission: 12/01/2026\nReported: 22/01/2026')).toBe(true)
    expect(usesDayFirst('10-02-2026 and 30.03.26')).toBe(true)
  })
  it('is false when every numeric date could be read either way', () => {
    expect(usesDayFirst('Date: 12/05/2026. Next visit: 02/06/2026')).toBe(false)
    expect(usesDayFirst('Reported 18 Mar 2026')).toBe(false)
  })
  it('ignores things that only look like dates', () => {
    expect(usesDayFirst('Reg. No. MP/PL/2014/0391; Tel 0755-2740 118; 13/2026')).toBe(false)
  })
})

describe('parseDate with dayFirst', () => {
  it('flags a genuinely ambiguous date by default, in plain DD/MM', () => {
    const p = parseDate('03/04/2026')
    expect(p.iso).toBe('2026-04-03')
    expect(p.flags).toContain('date_ambiguous')
  })
  it('does not flag it once the document is known to be day first', () => {
    const p = parseDate('03/04/2026', { dayFirst: true })
    expect(p.iso).toBe('2026-04-03')
    expect(p.flags).not.toContain('date_ambiguous')
    expect(p.alternatives).toBeUndefined()
  })
})
