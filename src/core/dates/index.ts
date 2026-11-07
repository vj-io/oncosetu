// India-first date parser (FR-EXT-03, E-DOC-11..14). Pure; no Date.now() — pass `now` / `anchor` explicitly.
import type { DatePrecision } from '../types'

export type DateFlag = 'date_ambiguous' | 'date_unknown' | 'date_future'

export interface ParsedDate {
  /** `YYYY-MM-DD`; month precision → 1st of month, year precision → 1 Jan. null when unknown. */
  iso: string | null
  precision: DatePrecision
  flags: DateFlag[]
  /** Input exactly as given (stored verbatim, E-DOC-13). */
  raw: string
  /** Other valid readings of an ambiguous numeric date (MM/DD). */
  alternatives?: string[]
}

export interface DateOptions {
  /** Reference "now" (ISO date or timestamp, or Date) for `date_future` and two-digit-year pivot. */
  now?: string | Date
  /** Explicit anchor date (`YYYY-MM-DD`) from the same document; enables relative expressions and year-less dates. */
  anchor?: string | null
  /**
   * The same document writes a numeric date whose first number is above 12 (e.g. 22/01/2026), so it counts day first:
   * every numeric date in it is read DD/MM and none is flagged ambiguous (see `usesDayFirst`).
   */
  dayFirst?: boolean
}

export interface DateSpan {
  raw: string
  start: number
  end: number
  kind: 'absolute' | 'relative'
}

// ---------- lexicon ----------

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, febr: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
  'जनवरी': 1, 'फरवरी': 2, '\u092B\u093Cरवरी': 2, '\u095Eरवरी': 2, 'मार्च': 3, 'अप्रैल': 4, 'अप्रेल': 4, 'मई': 5, 'जून': 6,
  'जुलाई': 7, 'अगस्त': 8, 'सितंबर': 9, 'सितम्बर': 9, 'अक्टूबर': 10, 'अक्तूबर': 10, 'नवंबर': 11, 'नवम्बर': 11,
  'दिसंबर': 12, 'दिसम्बर': 12,
}
const MONTH_ALT = Object.keys(MONTH_NAMES)
  .sort((a, b) => b.length - a.length)
  .map((m) => m.replace(/\./g, '\\.'))
  .join('|')
// Month token: name, optional abbreviation dot, not followed by more letters.
const MON = `(${MONTH_ALT})\\.?(?![\\p{L}\\p{M}])`
const NB = '(?<![\\p{L}\\p{M}\\d])' // left boundary
const NA = '(?![\\p{L}\\p{M}\\d])' // right boundary
const ORD = '(?:st|nd|rd|th)?'

const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  'couple of': 2, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5, 'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8,
  'नौ': 9, 'दस': 10,
}
const UNIT: Record<string, 'day' | 'week' | 'month' | 'year'> = {
  day: 'day', days: 'day', week: 'week', weeks: 'week', wk: 'week', wks: 'week', month: 'month', months: 'month',
  mo: 'month', mos: 'month', year: 'year', years: 'year', yr: 'year', yrs: 'year',
  'दिन': 'day', 'हफ़्ते': 'week', 'हफ्ते': 'week', 'हफ़्ता': 'week', 'हफ्ता': 'week', 'सप्ताह': 'week',
  'महीने': 'month', 'महीना': 'month', 'माह': 'month', 'साल': 'year', 'वर्ष': 'year',
}
const alt = (keys: string[]) => keys.sort((a, b) => b.length - a.length).join('|')
const QTY = `(\\d{1,3}|few|${alt(Object.keys(NUM_WORDS))})`
const UNITS = `(${alt(Object.keys(UNIT))})`

// ---------- patterns ----------

type Parts =
  | { kind: 'numeric'; a: number; b: number; y: string } // a/b order as written (DD/MM default)
  | { kind: 'ymd'; y: string; m: number; d: number }
  | { kind: 'named'; y: string | null; m: number; d: number | null }
  | { kind: 'month_numeric'; y: string; m: number }
  | { kind: 'year'; y: string }
  | { kind: 'partial_numeric'; a: number; b: number }
  | { kind: 'relative'; n: number | null; unit: 'day' | 'week' | 'month' | 'year' }

interface Pattern {
  re: RegExp
  kind: 'absolute' | 'relative'
  parts: (m: RegExpExecArray) => Parts
  /** Only used by parseDate on the whole string, never by findDates. */
  parseOnly?: boolean
}

const monthOf = (s: string) => MONTH_NAMES[s.toLowerCase()]

const PATTERNS: Pattern[] = [
  // 2026-03-12, 2026/03/12
  {
    re: new RegExp(`${NB}(\\d{4})([-/.])(\\d{1,2})\\2(\\d{1,2})(?:(?=T\\d)|${NA})`, 'giu'),
    kind: 'absolute',
    parts: (m) => ({ kind: 'ymd', y: m[1], m: +m[3], d: +m[4] }),
  },
  // 12/03/2026, 12-03-26, 12.03.2026, 12 / 03 / 2026
  {
    re: new RegExp(`${NB}(\\d{1,2})\\s*([-/.])\\s*(\\d{1,2})\\s*\\2\\s*(\\d{4}|\\d{2})${NA}`, 'giu'),
    kind: 'absolute',
    parts: (m) => ({ kind: 'numeric', a: +m[1], b: +m[3], y: m[4] }),
  },
  // 12 Mar 2026, 12-Mar-26, 12th March, 2026, 12th of March 2026, १२ मार्च २०२६
  {
    re: new RegExp(`${NB}(\\d{1,2})${ORD}(?:\\s+of)?[\\s\\-/.,]*${MON}[\\s\\-/.,'’]*(\\d{4}|\\d{2})${NA}`, 'giu'),
    kind: 'absolute',
    parts: (m) => ({ kind: 'named', d: +m[1], m: monthOf(m[2]), y: m[3] }),
  },
  // March 12, 2026 / Mar 12 2026 / March 12th, 2026
  {
    re: new RegExp(`${NB}${MON}\\s*(\\d{1,2})${ORD},?\\s+(\\d{4})${NA}`, 'giu'),
    kind: 'absolute',
    parts: (m) => ({ kind: 'named', m: monthOf(m[1]), d: +m[2], y: m[3] }),
  },
  // Mar-2026, March 2026, Mar'26, Mar-26
  {
    re: new RegExp(`${NB}${MON}(?:[\\s\\-/.,]*(\\d{4})|\\s*[-'’]\\s*(\\d{2}))${NA}`, 'giu'),
    kind: 'absolute',
    parts: (m) => ({ kind: 'named', m: monthOf(m[1]), d: null, y: m[2] ?? m[3] }),
  },
  // 03/2026
  {
    re: new RegExp(`(?<![\\d/.\\-])(\\d{1,2})[/.\\-](\\d{4})(?![\\d/.\\-])`, 'giu'),
    kind: 'absolute',
    parts: (m) => ({ kind: 'month_numeric', m: +m[1], y: m[2] }),
  },
  // 12 Mar (no year) — parseDate only
  {
    re: new RegExp(`^(\\d{1,2})${ORD}(?:\\s+of)?[\\s\\-/.,]*${MON}$`, 'iu'),
    kind: 'absolute',
    parts: (m) => ({ kind: 'named', d: +m[1], m: monthOf(m[2]), y: null }),
    parseOnly: true,
  },
  // 12/03 (no year) — parseDate only
  {
    re: /^(\d{1,2})\s*[-/.]\s*(\d{1,2})$/u,
    kind: 'absolute',
    parts: (m) => ({ kind: 'partial_numeric', a: +m[1], b: +m[2] }),
    parseOnly: true,
  },
  // 2026 — parseDate only
  {
    re: /^(\d{4})$/u,
    kind: 'absolute',
    parts: (m) => ({ kind: 'year', y: m[1] }),
    parseOnly: true,
  },
  // 3 weeks back / two months ago / few days before / 3 हफ्ते पहले
  {
    re: new RegExp(`${NB}${QTY}\\s+${UNITS}\\s+(?:ago|back|before|earlier|पहले|पूर्व)${NA}`, 'giu'),
    kind: 'relative',
    parts: (m) => ({ kind: 'relative', n: NUM_WORDS[m[1].toLowerCase()] ?? (/^\d+$/.test(m[1]) ? +m[1] : null), unit: UNIT[m[2].toLowerCase()] }),
  },
  // last month / previous week / पिछले महीने
  {
    re: new RegExp(`${NB}(?:last|previous|past|पिछले|पिछली|पिछला)\\s+${UNITS}${NA}`, 'giu'),
    kind: 'relative',
    parts: (m) => ({ kind: 'relative', n: 1, unit: UNIT[m[1].toLowerCase()] }),
  },
  // day before yesterday / yesterday / today / कल / आज / परसों
  {
    re: new RegExp(`${NB}(day before yesterday|yesterday|today|परसों|कल|आज)${NA}`, 'giu'),
    kind: 'relative',
    parts: (m) => {
      const w = m[1].toLowerCase()
      if (w === 'today' || w === 'आज') return { kind: 'relative', n: 0, unit: 'day' }
      if (w === 'yesterday') return { kind: 'relative', n: 1, unit: 'day' }
      if (w === 'day before yesterday') return { kind: 'relative', n: 2, unit: 'day' }
      return { kind: 'relative', n: null, unit: 'day' } // कल / परसों: yesterday or tomorrow — never resolved
    },
  },
]

/** Devanagari digits → ASCII (one UTF-16 unit each, so offsets are preserved). */
export function toAsciiDigits(s: string): string {
  return s.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966))
}

interface Hit extends DateSpan {
  parts: Parts
}

function scan(text: string, includeParseOnly: boolean): Hit[] {
  const t = toAsciiDigits(text)
  const hits: Hit[] = []
  for (const p of PATTERNS) {
    if (p.parseOnly && !includeParseOnly) continue
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g')
    for (let m = re.exec(t); m; m = re.exec(t)) {
      if (m[0].length === 0) {
        re.lastIndex++
        continue
      }
      const parts = p.parts(m)
      if ((parts.kind === 'named' || parts.kind === 'ymd' || parts.kind === 'month_numeric') && !parts.m) continue
      hits.push({ raw: text.slice(m.index, m.index + m[0].length), start: m.index, end: m.index + m[0].length, kind: p.kind, parts })
    }
  }
  // Non-overlapping: earliest start, then longest.
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Hit[] = []
  for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h)
  return out
}

/**
 * True when the text has a numeric date that can only be day first (a first number above 12 with a valid month second,
 * such as 22/01/2026). Indian records are day first throughout, so one such date settles the others in the same document.
 */
export function usesDayFirst(text: string): boolean {
  for (const m of toAsciiDigits(text).matchAll(/(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?!\d|[/.-]\d)/g)) {
    if (+m[1] > 12 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) return true
  }
  return false
}

/** All date-like spans in `text` (absolute and relative), with offsets into the original string. */
export function findDates(text: string): DateSpan[] {
  return scan(text, false).map(({ raw, start, end, kind }) => ({ raw, start, end, kind }))
}

// ---------- calendar helpers ----------

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const valid = (y: number, m: number, d: number) => y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m)
const isoOf = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`

function toDay(v: string | Date): string {
  if (v instanceof Date) return new Date(v.getTime() + 330 * 60_000).toISOString().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(Date.parse(v) + 330 * 60_000).toISOString().slice(0, 10)
}

function fullYear(y: string, now?: string | Date): number {
  if (y.length === 4) return +y
  const yy = +y
  const pivot = now ? (+toDay(now).slice(0, 4) + 1) % 100 : 50
  return yy <= pivot ? 2000 + yy : 1900 + yy
}

/** Adds days to a `YYYY-MM-DD` date. */
export function addDays(iso: string, days: number): string {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** Whole days from a to b (b − a), both `YYYY-MM-DD`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
}

/** First and last calendar day covered by a date of the given precision. */
export function dateRange(iso: string, precision: DatePrecision): [string, string] {
  const y = +iso.slice(0, 4)
  const m = +iso.slice(5, 7)
  if (precision === 'year') return [`${pad(y, 4)}-01-01`, `${pad(y, 4)}-12-31`]
  if (precision === 'month') return [isoOf(y, m, 1), isoOf(y, m, daysIn(y, m))]
  return [iso, iso]
}

// ---------- parse ----------

const unknown = (raw: string): ParsedDate => ({ iso: null, precision: 'unknown', flags: ['date_unknown'], raw })

function resolve(parts: Parts, raw: string, opts: DateOptions): ParsedDate {
  const anchor = opts.anchor ?? null
  switch (parts.kind) {
    case 'ymd':
      return valid(+parts.y, parts.m, parts.d) ? { iso: isoOf(+parts.y, parts.m, parts.d), precision: 'day', flags: [], raw } : unknown(raw)
    case 'numeric':
    case 'partial_numeric': {
      const y = parts.kind === 'numeric' ? fullYear(parts.y, opts.now) : anchor ? +anchor.slice(0, 4) : null
      if (y === null) return unknown(raw)
      const dm = valid(y, parts.b, parts.a) ? isoOf(y, parts.b, parts.a) : null // DD/MM (India default)
      const md = valid(y, parts.a, parts.b) ? isoOf(y, parts.a, parts.b) : null // MM/DD
      if (dm && md && dm !== md) return opts.dayFirst ? { iso: dm, precision: 'day', flags: [], raw } : { iso: dm, precision: 'day', flags: ['date_ambiguous'], raw, alternatives: [md] }
      const iso = dm ?? md
      return iso ? { iso, precision: 'day', flags: [], raw } : unknown(raw)
    }
    case 'named': {
      const y = parts.y !== null ? fullYear(parts.y, opts.now) : anchor ? +anchor.slice(0, 4) : null
      if (y === null) return unknown(raw)
      if (parts.d === null) return valid(y, parts.m, 1) ? { iso: isoOf(y, parts.m, 1), precision: 'month', flags: [], raw } : unknown(raw)
      return valid(y, parts.m, parts.d) ? { iso: isoOf(y, parts.m, parts.d), precision: 'day', flags: [], raw } : unknown(raw)
    }
    case 'month_numeric':
      return valid(+parts.y, parts.m, 1) ? { iso: isoOf(+parts.y, parts.m, 1), precision: 'month', flags: [], raw } : unknown(raw)
    case 'year':
      return valid(+parts.y, 1, 1) ? { iso: `${parts.y}-01-01`, precision: 'year', flags: [], raw } : unknown(raw)
    case 'relative': {
      if (!anchor || parts.n === null) return unknown(raw)
      const a = toDay(anchor)
      if (parts.unit === 'day') return { iso: addDays(a, -parts.n), precision: 'day', flags: [], raw }
      if (parts.unit === 'week') return { iso: addDays(a, -7 * parts.n), precision: 'day', flags: [], raw }
      const y = +a.slice(0, 4)
      const m = +a.slice(5, 7)
      if (parts.unit === 'year') return { iso: `${pad(y - parts.n, 4)}-01-01`, precision: 'year', flags: [], raw }
      const total = y * 12 + (m - 1) - parts.n
      return { iso: isoOf(Math.floor(total / 12), (total % 12) + 1, 1), precision: 'month', flags: [], raw }
    }
  }
}

/**
 * Parses one date expression. Unknown/relative-without-anchor → `{iso:null, precision:'unknown', flags:['date_unknown']}`.
 * Ambiguous numeric dates (both parts ≤ 12, no month name) → DD/MM reading + `date_ambiguous` + `alternatives:[MM/DD]`.
 * With `now`, dates whose first covered day is after now's IST date get `date_future`.
 */
export function parseDate(raw: string, opts: DateOptions = {}): ParsedDate {
  const cleaned = toAsciiDigits(raw).trim().replace(/^[\s:.,;-]+|[\s.,;:)]+$/g, '')
  if (!cleaned) return unknown(raw)
  // Whole-string forms first (year, year-less), then the first span found inside the text.
  let parts: Parts | null = null
  for (const p of PATTERNS) {
    if (!p.parseOnly) continue
    const m = p.re.exec(cleaned)
    if (m) {
      parts = p.parts(m)
      break
    }
  }
  if (!parts) parts = scan(cleaned, false)[0]?.parts ?? null
  if (!parts) return unknown(raw)
  const out = resolve(parts, raw, opts)
  if (out.iso && opts.now && out.iso > toDay(opts.now)) out.flags.push('date_future')
  return out
}
