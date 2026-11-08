// Evidence gate (PRD §9.4, FR-EXT-02/05/09/10). Deterministic; never trusts model offsets.
import { lintText } from '../copy/banned'
import { findDates, parseDate } from '../dates'
import { sha256Hex } from '../hash'
import { EVENT_FIELDS, EVENT_TYPES, type EventFlag, type EventType } from '../types'

export interface OcrWord {
  /** token text */
  t: string
  /** confidence 0..1 (0..100 accepted and scaled) */
  c: number
  /** char start/end offsets into the page text */
  s: number
  e: number
}

export interface GatePage {
  pageNo: number
  text: string
  /** OCR words; absent for text-layer pages. */
  words?: OcrWord[]
}

/** Shape the LLM (schema extraction.v1) and the pattern extractor both emit. */
export interface Candidate {
  event_type: string
  fields: Record<string, unknown>
  quote: string
  page_no?: number | null
  /** Who proposed it; the gate treats both the same. */
  origin?: 'llm' | 'rules'
}

export type RejectReason =
  | 'unknown_event_type'
  | 'event_type_not_extractable'
  | 'forbidden_field'
  | 'field_not_allowed'
  | 'invalid_field_value'
  | 'quote_too_short'
  | 'quote_too_long'
  | 'quote_not_found'
  | 'field_not_in_quote'
  | 'date_not_in_quote'

export interface GateEvidence {
  pageNo: number
  charStart: number
  charEnd: number
  /** Raw page text slice: `pages[pageNo].text.slice(charStart, charEnd)`. */
  quote: string
  quoteSha256: string
  /** Mean OCR word confidence over the span (0..1); null for text-layer pages. */
  spanConfidence: number | null
  /** Present only when the quote runs onto the next page (flagged binding_uncertain). */
  continuation?: { pageNo: number; charStart: number; charEnd: number; quote: string }
}

export interface Accepted {
  candidate: Candidate
  evidence: GateEvidence
  flags: EventFlag[]
}
export interface Rejected {
  candidate: Candidate
  reason: RejectReason
  detail?: string
  /** The banned-list term a model's field value hit (§9.6); the list entry, never the document's text. */
  banned?: string
}
export interface GateResult {
  accepted: Accepted[]
  rejected: Rejected[]
}

export const QUOTE_MIN = 8
export const QUOTE_MAX = 300
export const CONFIDENCE_MIN = 0.8
export const HEADER_LINES = 15

/** Key tokens that make a field forbidden (FR-EXT-05: no inference fields), checked before the allow-list. */
const FORBIDDEN_TOKENS = new Set([
  'stage', 'staging', 'tnm', 'ajcc', 'figo', 'grade', 'grading', 'gleason', 'response', 'responded', 'recist',
  'remission', 'progression', 'progressive', 'progressed', 'recurrence', 'relapse', 'metastasis', 'metastatic',
  'risk', 'score', 'prognosis', 'prognostic', 'survival', 'dose', 'dosage', 'dosing', 'diagnosis', 'diagnoses',
  'diagnosed', 'dx', 'impression', 'interpretation', 'conclusion', 'assessment', 'opinion', 'severity',
  'prediction', 'predicted', 'suspected', 'suspicion', 'recommendation', 'recommendations', 'recommend',
  'recommended', 'advice', 'advised', 'advise', 'plan', 'suggestion', 'suggested', 'ecog', 'kps', 'performance',
])
const HEADER_OR_QUOTE_FIELDS = new Set(['institution_name', 'test_name', 'test_names'])
/**
 * §9.6: model field values are linted for Radar/legal wording. Exempt: test and drug names, dates, and the "as written"
 * fields, which hold a whole line of the document word for word (a quote, like `quote` itself, e.g. "No abnormal uptake").
 */
const LINT_EXEMPT = new Set([
  'test_name', 'test_names', 'medication_names', 'event_date', 'event_date_text', 'cycle_number',
  'section_text', 'history_text', 'marker_text', 'margins_text', 'addendum_text', 'allergy_text',
])
const NOT_EXTRACTABLE = new Set<string>(['document_received', 'patient_statement'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// ---------- normalisation with raw-offset map ----------

const WS = /\s/u
const MARK = /\p{M}/u

/** §9.4 normalise: collapse whitespace runs to one space, NFC, trim. No case folding, no punctuation removal. */
export function normalise(s: string): string {
  return s.replace(/\s+/gu, ' ').normalize('NFC').trim()
}

interface NormMap {
  norm: string
  starts: number[]
  ends: number[]
}

/** Normalised text (not trimmed) plus, for every normalised UTF-16 unit, the raw [start, end) it came from. */
function normaliseWithMap(raw: string): NormMap {
  let norm = ''
  const starts: number[] = []
  const ends: number[] = []
  let i = 0
  while (i < raw.length) {
    const cp = raw.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    if (WS.test(ch)) {
      let j = i + ch.length
      while (j < raw.length && WS.test(raw[j])) j++
      norm += ' '
      starts.push(i)
      ends.push(j)
      i = j
      continue
    }
    // cluster = code point + following combining marks; NFC within the cluster
    let j = i + ch.length
    while (j < raw.length) {
      const next = String.fromCodePoint(raw.codePointAt(j)!)
      if (!MARK.test(next)) break
      j += next.length
    }
    const piece = raw.slice(i, j).normalize('NFC')
    norm += piece
    for (let k = 0; k < piece.length; k++) {
      starts.push(i)
      ends.push(j)
    }
    i = j
  }
  return { norm, starts, ends }
}

/** Finds `needle` in `text` after normalising both; returns RAW offsets into `text`, or null. */
export function findNormalised(text: string, needle: string, map: NormMap = normaliseWithMap(text)): { start: number; end: number } | null {
  const n = normalise(needle)
  if (!n) return null
  const { norm, starts } = map
  // A match must start and end on cluster boundaries (never split a base letter from its combining marks).
  for (let idx = norm.indexOf(n); idx !== -1; idx = norm.indexOf(n, idx + 1)) {
    const end = idx + n.length
    if ((idx === 0 || starts[idx - 1] !== starts[idx]) && (end === norm.length || starts[end] !== starts[end - 1])) {
      return { start: starts[idx], end: map.ends[end - 1] }
    }
  }
  return null
}

// ---------- helpers ----------

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function headerRegion(text: string): string {
  return normalise(text.split(/\r\n|\r|\n/).slice(0, HEADER_LINES).join('\n'))
}

function wordConfidence(c: number): number {
  return c > 1 ? c / 100 : c
}

function spanWords(page: GatePage, start: number, end: number): number[] {
  return (page.words ?? []).filter((w) => w.s < end && w.e > start).map((w) => wordConfidence(w.c))
}

type FieldCheck = { ok: true } | { ok: false; reason: RejectReason; detail: string; banned?: string }

function checkFields(c: Candidate): FieldCheck {
  const allowed = EVENT_FIELDS[c.event_type as EventType]
  for (const [key, value] of Object.entries(c.fields ?? {})) {
    if (value === null || value === undefined) continue
    if (keyTokens(key).some((t) => FORBIDDEN_TOKENS.has(t))) return { ok: false, reason: 'forbidden_field', detail: key }
    if (!allowed.includes(key)) return { ok: false, reason: 'field_not_allowed', detail: key }
    const okString = (v: unknown) => typeof v === 'string' && normalise(v).length > 0
    const valid =
      okString(value) ||
      (Array.isArray(value) && value.length > 0 && value.every(okString)) ||
      (key === 'cycle_number' && typeof value === 'number' && Number.isInteger(value) && value >= 0)
    if (!valid) return { ok: false, reason: 'invalid_field_value', detail: key }
    // §9.6 banned-word check on model output: a value carrying advice, urgency or a legal claim is not a field value.
    if (c.origin === 'llm' && !LINT_EXEMPT.has(key)) {
      const hit = (Array.isArray(value) ? value : [value]).flatMap((v) => (typeof v === 'string' ? lintText(v, ['radar', 'legal']) : []))[0]
      if (hit) return { ok: false, reason: 'invalid_field_value', detail: key, banned: hit.term }
    }
  }
  return { ok: true }
}

function dateInQuote(iso: string, quote: string): boolean {
  return findDates(quote).some((s) => {
    const p = parseDate(s.raw)
    return p.iso === iso || (p.alternatives ?? []).includes(iso)
  })
}

// ---------- gate ----------

interface Located {
  page: GatePage
  start: number
  end: number
  continuation?: { page: GatePage; start: number; end: number }
}

function locate(quote: string, pages: GatePage[], pageNo: number | null | undefined, maps: Map<GatePage, NormMap>): Located | null {
  const sorted = [...pages].sort((a, b) => a.pageNo - b.pageNo)
  const stated = sorted.find((p) => p.pageNo === pageNo)
  const order = stated ? [stated, ...sorted.filter((p) => p !== stated)] : sorted // §9.4 fallback: search all pages
  for (const page of order) {
    const hit = findNormalised(page.text, quote, maps.get(page))
    if (hit) return { page, ...hit }
  }
  // Quote running across a page boundary (FR-EXT-09 → binding_uncertain).
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (b.pageNo !== a.pageNo + 1) continue
    const joined = a.text + '\n' + b.text
    const hit = findNormalised(joined, quote)
    if (hit && hit.start < a.text.length && hit.end > a.text.length + 1) {
      return { page: a, start: hit.start, end: a.text.length, continuation: { page: b, start: 0, end: hit.end - a.text.length - 1 } }
    }
  }
  return null
}

/**
 * Runs the evidence gate. Every accepted item's `evidence.quote` is an exact slice of its page text;
 * every string field value appears in the normalised quote (institution/test names may instead appear in the
 * first 15 lines of the page or of the first page); ISO `event_date` values must have a raw date in the quote
 * that parses to them; `cycle_number` digits must appear in the quote.
 */
export function runGate(candidates: Candidate[], pages: GatePage[]): GateResult {
  const accepted: Accepted[] = []
  const rejected: Rejected[] = []
  const maps = new Map(pages.map((p) => [p, normaliseWithMap(p.text)] as const))
  const firstPage = [...pages].sort((a, b) => a.pageNo - b.pageNo)[0]
  const reject = (candidate: Candidate, reason: RejectReason, detail?: string, banned?: string) => rejected.push({ candidate, reason, ...(detail ? { detail } : {}), ...(banned ? { banned } : {}) })

  for (const c of candidates) {
    if (!(EVENT_TYPES as readonly string[]).includes(c.event_type)) {
      reject(c, 'unknown_event_type', String(c.event_type))
      continue
    }
    if (NOT_EXTRACTABLE.has(c.event_type)) {
      reject(c, 'event_type_not_extractable', c.event_type)
      continue
    }
    const fc = checkFields(c)
    if (!fc.ok) {
      reject(c, fc.reason, fc.detail, fc.banned)
      continue
    }
    const nq = normalise(typeof c.quote === 'string' ? c.quote : '')
    const len = [...nq].length
    if (len < QUOTE_MIN) {
      reject(c, 'quote_too_short')
      continue
    }
    if (len > QUOTE_MAX) {
      reject(c, 'quote_too_long')
      continue
    }
    const loc = locate(nq, pages, c.page_no, maps)
    if (!loc) {
      reject(c, 'quote_not_found')
      continue
    }

    // Field values must be in the (normalised) located quote text.
    const quoteRaw = loc.page.text.slice(loc.start, loc.end) + (loc.continuation ? '\n' + loc.continuation.page.text.slice(0, loc.continuation.end) : '')
    const quoteNorm = normalise(quoteRaw)
    const headers = [headerRegion(loc.page.text), firstPage ? headerRegion(firstPage.text) : '']
    let failure: { reason: RejectReason; detail: string } | null = null
    for (const [key, value] of Object.entries(c.fields ?? {})) {
      if (value === null || value === undefined) continue
      if (key === 'event_date' && typeof value === 'string' && ISO_DATE.test(value) && !quoteNorm.includes(value)) {
        if (!dateInQuote(value, quoteRaw)) failure = { reason: 'date_not_in_quote', detail: key }
      } else if (typeof value === 'number') {
        if (!new RegExp(`(?<!\\d)${value}(?!\\d)`).test(quoteNorm)) failure = { reason: 'field_not_in_quote', detail: key }
      } else {
        for (const v of (Array.isArray(value) ? value : [value]) as string[]) {
          const nv = normalise(v)
          const inQuote = quoteNorm.includes(nv)
          const inHeader = HEADER_OR_QUOTE_FIELDS.has(key) && headers.some((h) => h.includes(nv))
          if (!inQuote && !inHeader) failure = { reason: 'field_not_in_quote', detail: key }
        }
      }
      if (failure) break
    }
    if (failure) {
      reject(c, failure.reason, failure.detail)
      continue
    }

    const confs = [
      ...spanWords(loc.page, loc.start, loc.end),
      ...(loc.continuation ? spanWords(loc.continuation.page, loc.continuation.start, loc.continuation.end) : []),
    ]
    const spanConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null
    const flags: EventFlag[] = []
    if (spanConfidence !== null && spanConfidence < CONFIDENCE_MIN) flags.push('low_confidence')
    if (loc.continuation || confs.some((x) => x < CONFIDENCE_MIN)) flags.push('binding_uncertain')

    const quote = loc.page.text.slice(loc.start, loc.end)
    accepted.push({
      candidate: c,
      evidence: {
        pageNo: loc.page.pageNo,
        charStart: loc.start,
        charEnd: loc.end,
        quote,
        quoteSha256: sha256Hex(quote),
        spanConfidence,
        ...(loc.continuation
          ? {
              continuation: {
                pageNo: loc.continuation.page.pageNo,
                charStart: 0,
                charEnd: loc.continuation.end,
                quote: loc.continuation.page.text.slice(0, loc.continuation.end),
              },
            }
          : {}),
      },
      flags,
    })
  }
  return { accepted, rejected }
}
