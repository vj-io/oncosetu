import { describe, expect, it } from 'vitest'
import { addDays, dateRange, daysBetween, findDates, parseDate, toAsciiDigits, type DateOptions } from '.'

const NOW = '2026-11-02'
type Exp = [iso: string | null, precision: string, flags?: string[], alternatives?: string[]]

// [raw, expected, opts?]
const CASES: [string, Exp, DateOptions?][] = [
  // --- DD/MM/YYYY family (unambiguous: day > 12) ---
  ['13/03/2026', ['2026-03-13', 'day']],
  ['31/12/2025', ['2025-12-31', 'day']],
  ['15-08-2026', ['2026-08-15', 'day']],
  ['28.02.2026', ['2026-02-28', 'day']],
  ['29/02/2024', ['2024-02-29', 'day']],
  ['25/1/2026', ['2026-01-25', 'day']],
  ['13 / 03 / 2026', ['2026-03-13', 'day']],
  ['16-10-25', ['2025-10-16', 'day']],
  ['20.06.26', ['2026-06-20', 'day']],
  ['30/09/2026', ['2026-09-30', 'day']],
  ['14/04/2026 10:30 AM', ['2026-04-14', 'day']],
  ['Date: 18/05/2026', ['2026-05-18', 'day']],
  ['DOA - 21/07/2026', ['2026-07-21', 'day']],
  ['Dt. 22.03.2026', ['2026-03-22', 'day']],
  ['on 19-01-2026.', ['2026-01-19', 'day']],
  ['17/11/1965', ['1965-11-17', 'day']],
  ['23/06/55', ['1955-06-23', 'day']],
  ['24/09/27', ['2027-09-24', 'day', ['date_future']], { now: NOW }],
  ['24/09/28', ['1928-09-24', 'day'], { now: NOW }],
  ['26/12/2030', ['2030-12-26', 'day', ['date_future']], { now: NOW }],
  // --- ambiguous (both ≤ 12, no month name) ---
  ['03/04/2026', ['2026-04-03', 'day', ['date_ambiguous'], ['2026-03-04']]],
  ['12/03/2026', ['2026-03-12', 'day', ['date_ambiguous'], ['2026-12-03']]],
  ['01-02-2026', ['2026-02-01', 'day', ['date_ambiguous'], ['2026-01-02']]],
  ['5.6.2026', ['2026-06-05', 'day', ['date_ambiguous'], ['2026-05-06']]],
  ['11/10/25', ['2025-10-11', 'day', ['date_ambiguous'], ['2025-11-10']]],
  ['1/12/2026', ['2026-12-01', 'day', ['date_ambiguous'], ['2026-01-12']]],
  ['12/1/2026', ['2026-01-12', 'day', ['date_ambiguous'], ['2026-12-01']]],
  ['09/08/2026', ['2026-08-09', 'day', ['date_ambiguous'], ['2026-09-08']]],
  ['02/03/2026', ['2026-03-02', 'day', ['date_ambiguous'], ['2026-02-03']]],
  ['10.11.2026', ['2026-11-10', 'day', ['date_ambiguous'], ['2026-10-11']]],
  ['07-05-26', ['2026-05-07', 'day', ['date_ambiguous'], ['2026-07-05']]],
  ['04/06/2026', ['2026-06-04', 'day', ['date_ambiguous'], ['2026-04-06']]],
  ['11/12/2026', ['2026-12-11', 'day', ['date_ambiguous', 'date_future'], ['2026-11-12']], { now: NOW }],
  // same day and month → one reading, not ambiguous
  ['03/03/2026', ['2026-03-03', 'day']],
  ['12.12.2025', ['2025-12-12', 'day']],
  ['07-07-26', ['2026-07-07', 'day']],
  // --- MM/DD when DD/MM is impossible ---
  ['03/15/2026', ['2026-03-15', 'day']],
  ['12/31/2025', ['2025-12-31', 'day']],
  // --- invalid ---
  ['31/02/2026', [null, 'unknown', ['date_unknown']]],
  ['32/01/2026', [null, 'unknown', ['date_unknown']]],
  ['29/02/2025', [null, 'unknown', ['date_unknown']]],
  ['13/13/2026', [null, 'unknown', ['date_unknown']]],
  ['00/01/2026', [null, 'unknown', ['date_unknown']]],
  ['31/04/2026', [null, 'unknown', ['date_unknown']]],
  ['', [null, 'unknown', ['date_unknown']]],
  ['   ', [null, 'unknown', ['date_unknown']]],
  ['N/A', [null, 'unknown', ['date_unknown']]],
  ['not known', [null, 'unknown', ['date_unknown']]],
  ['--', [null, 'unknown', ['date_unknown']]],
  ['1850', [null, 'unknown', ['date_unknown']]],
  // --- ISO ---
  ['2026-03-12', ['2026-03-12', 'day']],
  ['2026/03/12', ['2026-03-12', 'day']],
  ['2026.3.5', ['2026-03-05', 'day']],
  ['2026-03-12T10:20:00Z', ['2026-03-12', 'day']],
  ['2026-02-30', [null, 'unknown', ['date_unknown']]],
  // --- day monthname year ---
  ['12 Mar 2026', ['2026-03-12', 'day']],
  ['12 March 2026', ['2026-03-12', 'day']],
  ['12-Mar-2026', ['2026-03-12', 'day']],
  ['12-MAR-2026', ['2026-03-12', 'day']],
  ['12-mar-26', ['2026-03-12', 'day']],
  ['12 Mar 26', ['2026-03-12', 'day']],
  ['12th March 2026', ['2026-03-12', 'day']],
  ['12th of March 2026', ['2026-03-12', 'day']],
  ['12th March, 2026', ['2026-03-12', 'day']],
  ['1st Jan 2026', ['2026-01-01', 'day']],
  ['2nd Feb 2026', ['2026-02-02', 'day']],
  ['3rd April 2026', ['2026-04-03', 'day']],
  ['21st Sept 2026', ['2026-09-21', 'day']],
  ['22nd Sep. 2026', ['2026-09-22', 'day']],
  ['5 May 2026', ['2026-05-05', 'day']],
  ['05/Jun/2026', ['2026-06-05', 'day']],
  ['7.Jul.2026', ['2026-07-07', 'day']],
  ['8 August 2026', ['2026-08-08', 'day']],
  ['9 Oct 2026', ['2026-10-09', 'day']],
  ['10 October, 2026', ['2026-10-10', 'day']],
  ['30 Nov 2026', ['2026-11-30', 'day', ['date_future']], { now: NOW }],
  ['31 Dec 2025', ['2025-12-31', 'day']],
  ['12 Mar\'26', ['2026-03-12', 'day']],
  ['04 Feb 2026', ['2026-02-04', 'day']],
  ['30 Feb 2026', [null, 'unknown', ['date_unknown']]],
  ['31 June 2026', [null, 'unknown', ['date_unknown']]],
  ['Reported on 15 Jan 2026 at 10:00', ['2026-01-15', 'day']],
  ['06 Jan 1970', ['1970-01-06', 'day']],
  // --- monthname day year ---
  ['March 12, 2026', ['2026-03-12', 'day']],
  ['Mar 12 2026', ['2026-03-12', 'day']],
  ['March 12th, 2026', ['2026-03-12', 'day']],
  ['January 1, 2026', ['2026-01-01', 'day']],
  ['Dec 31, 2025', ['2025-12-31', 'day']],
  ['February 29, 2028', ['2028-02-29', 'day']],
  ['April 31, 2026', [null, 'unknown', ['date_unknown']]],
  ['Aug 15, 2026', ['2026-08-15', 'day']],
  ['Sept 3rd, 2026', ['2026-09-03', 'day']],
  ['November 2, 2026', ['2026-11-02', 'day'], { now: NOW }],
  ['November 3, 2026', ['2026-11-03', 'day', ['date_future']], { now: NOW }],
  // --- month precision ---
  ['Mar-2026', ['2026-03-01', 'month']],
  ['March 2026', ['2026-03-01', 'month']],
  ['MAR 2026', ['2026-03-01', 'month']],
  ['Mar\'26', ['2026-03-01', 'month']],
  ['Mar-26', ['2026-03-01', 'month']],
  ['Sept 2025', ['2025-09-01', 'month']],
  ['December, 2025', ['2025-12-01', 'month']],
  ['03/2026', ['2026-03-01', 'month']],
  ['3-2026', ['2026-03-01', 'month']],
  ['12.2025', ['2025-12-01', 'month']],
  ['13/2026', [null, 'unknown', ['date_unknown']]],
  ['Dec 2026', ['2026-12-01', 'month', ['date_future']], { now: NOW }],
  ['Nov 2026', ['2026-11-01', 'month'], { now: NOW }],
  ['since Jan 2026', ['2026-01-01', 'month']],
  // --- year precision ---
  ['2026', ['2026-01-01', 'year']],
  ['2019', ['2019-01-01', 'year']],
  ['2027', ['2027-01-01', 'year', ['date_future']], { now: NOW }],
  ['2026', ['2026-01-01', 'year'], { now: NOW }],
  // --- Hindi months and Devanagari digits ---
  ['१२ मार्च २०२६', ['2026-03-12', 'day']],
  ['12 मार्च 2026', ['2026-03-12', 'day']],
  ['१२/०३/२०२६', ['2026-03-12', 'day', ['date_ambiguous'], ['2026-12-03']]],
  ['१५/०८/२०२६', ['2026-08-15', 'day']],
  ['5 जनवरी 2026', ['2026-01-05', 'day']],
  ['10 फरवरी 2026', ['2026-02-10', 'day']],
  ['10 फ़रवरी 2026', ['2026-02-10', 'day']],
  ['10 फ़रवरी 2026', ['2026-02-10', 'day']],
  ['3 अप्रैल 2026', ['2026-04-03', 'day']],
  ['3 अप्रेल 2026', ['2026-04-03', 'day']],
  ['20 मई 2026', ['2026-05-20', 'day']],
  ['21 जून 2026', ['2026-06-21', 'day']],
  ['22 जुलाई 2026', ['2026-07-22', 'day']],
  ['15 अगस्त 2026', ['2026-08-15', 'day']],
  ['1 सितंबर 2026', ['2026-09-01', 'day']],
  ['1 सितम्बर 2026', ['2026-09-01', 'day']],
  ['2 अक्टूबर 2025', ['2025-10-02', 'day']],
  ['2 अक्तूबर 2025', ['2025-10-02', 'day']],
  ['14 नवंबर 2025', ['2025-11-14', 'day']],
  ['14 नवम्बर 2025', ['2025-11-14', 'day']],
  ['25 दिसंबर 2025', ['2025-12-25', 'day']],
  ['25 दिसम्बर 2025', ['2025-12-25', 'day']],
  ['मार्च २०२६', ['2026-03-01', 'month']],
  ['जनवरी 2026', ['2026-01-01', 'month']],
  ['दिनांक: १२/१२/२०२५', ['2025-12-12', 'day']],
  ['२०२६', ['2026-01-01', 'year']],
  // --- relative without anchor → date_unknown, raw kept ---
  ['3 weeks back', [null, 'unknown', ['date_unknown']]],
  ['3 weeks ago', [null, 'unknown', ['date_unknown']]],
  ['two months ago', [null, 'unknown', ['date_unknown']]],
  ['last month', [null, 'unknown', ['date_unknown']]],
  ['last week', [null, 'unknown', ['date_unknown']]],
  ['yesterday', [null, 'unknown', ['date_unknown']]],
  ['today', [null, 'unknown', ['date_unknown']]],
  ['a year ago', [null, 'unknown', ['date_unknown']]],
  ['few days back', [null, 'unknown', ['date_unknown']]],
  ['3 हफ्ते पहले', [null, 'unknown', ['date_unknown']]],
  ['पिछले महीने', [null, 'unknown', ['date_unknown']]],
  ['कल', [null, 'unknown', ['date_unknown']]],
  ['2 साल पहले', [null, 'unknown', ['date_unknown']]],
  ['10 days ago', [null, 'unknown', ['date_unknown']]],
  ['12 Mar', [null, 'unknown', ['date_unknown']]],
  ['12/03', [null, 'unknown', ['date_unknown']]],
  // --- relative with explicit anchor ---
  ['3 weeks back', ['2026-02-19', 'day'], { anchor: '2026-03-12' }],
  ['10 days ago', ['2026-03-02', 'day'], { anchor: '2026-03-12' }],
  ['two months ago', ['2026-01-01', 'month'], { anchor: '2026-03-12' }],
  ['last month', ['2026-02-01', 'month'], { anchor: '2026-03-12' }],
  ['last month', ['2025-12-01', 'month'], { anchor: '2026-01-10' }],
  ['last week', ['2026-03-05', 'day'], { anchor: '2026-03-12' }],
  ['yesterday', ['2026-03-11', 'day'], { anchor: '2026-03-12' }],
  ['day before yesterday', ['2026-03-10', 'day'], { anchor: '2026-03-12' }],
  ['today', ['2026-03-12', 'day'], { anchor: '2026-03-12' }],
  ['a year ago', ['2025-01-01', 'year'], { anchor: '2026-03-12' }],
  ['3 हफ्ते पहले', ['2026-02-19', 'day'], { anchor: '2026-03-12' }],
  ['पिछले महीने', ['2026-02-01', 'month'], { anchor: '2026-03-12' }],
  ['दो साल पहले', ['2024-01-01', 'year'], { anchor: '2026-03-12' }],
  ['कल', [null, 'unknown', ['date_unknown']], { anchor: '2026-03-12' }],
  ['few days back', [null, 'unknown', ['date_unknown']], { anchor: '2026-03-12' }],
  ['12 Mar', ['2026-03-12', 'day'], { anchor: '2026-04-01' }],
  ['15/03', ['2026-03-15', 'day'], { anchor: '2026-04-01' }],
  ['05/03', ['2026-03-05', 'day', ['date_ambiguous'], ['2026-05-03']], { anchor: '2026-04-01' }],
]

describe('parseDate', () => {
  it('has at least 150 cases', () => expect(CASES.length).toBeGreaterThanOrEqual(150))

  it.each(CASES.map(([raw, exp, opts], i) => [i, raw, exp, opts] as const))('#%i %s', (_i, raw, [iso, precision, flags = [], alternatives], opts) => {
    const r = parseDate(raw, opts)
    expect(r.iso).toBe(iso)
    expect(r.precision).toBe(precision)
    expect(r.flags).toEqual(flags)
    expect(r.raw).toBe(raw)
    if (alternatives) expect(r.alternatives).toEqual(alternatives)
    else expect(r.alternatives).toBeUndefined()
  })

  it('every ambiguous numeric date is flagged (both parts ≤ 12, differ)', () => {
    for (let a = 1; a <= 12; a++)
      for (let b = 1; b <= 12; b++) {
        const r = parseDate(`${a}/${b}/2026`)
        expect(r.flags.includes('date_ambiguous')).toBe(a !== b)
        if (a !== b) expect(r.alternatives).toHaveLength(1)
      }
  })

  it('accepts a Date object as now', () => {
    expect(parseDate('03/11/2026', { now: new Date('2026-11-02T20:00:00Z') }).flags).toEqual(['date_ambiguous'])
  })
})

describe('findDates', () => {
  it('finds spans with offsets into the original text', () => {
    const text = 'DOA: 12/03/2026, DOD: 18-Mar-2026. Biopsy done 3 weeks back. Follow up March 2026.'
    const spans = findDates(text)
    expect(spans.map((s) => s.raw)).toEqual(['12/03/2026', '18-Mar-2026', '3 weeks back', 'March 2026'])
    for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.raw)
    expect(spans.map((s) => s.kind)).toEqual(['absolute', 'absolute', 'relative', 'absolute'])
  })

  it('preserves offsets with Devanagari digits', () => {
    const text = 'रिपोर्ट दिनांक १५/०८/२०२६ को'
    const [s] = findDates(text)
    expect(s.raw).toBe('१५/०८/२०२६')
    expect(text.slice(s.start, s.end)).toBe(s.raw)
  })

  it('ignores numbers that are not dates', () => {
    expect(findDates('UHID 2026031201, Hb 10.2 g/dl, BP 120/80, Ph 98765-43210, 2026')).toEqual([])
  })

  it('prefers the longest match at a position', () => {
    expect(findDates('on 12 March 2026').map((s) => s.raw)).toEqual(['12 March 2026'])
  })

  it('does not match month names inside words', () => {
    expect(findDates('Marching 2026 Mayday 2026')).toEqual([])
  })
})

describe('helpers', () => {
  it('toAsciiDigits', () => expect(toAsciiDigits('१२३४५६७८९०')).toBe('1234567890'))
  it('addDays / daysBetween', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59)
  })
  it('dateRange', () => {
    expect(dateRange('2026-02-01', 'month')).toEqual(['2026-02-01', '2026-02-28'])
    expect(dateRange('2024-01-01', 'year')).toEqual(['2024-01-01', '2024-12-31'])
    expect(dateRange('2026-02-05', 'day')).toEqual(['2026-02-05', '2026-02-05'])
  })
})
