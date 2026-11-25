// Pure builders for what the patient sees on the home page, plus small display helpers (FR-CON-07).
// Everything here takes data in and returns plain strings: unit-tested for zero diagnosis words (portal.test.ts).
import { consentFormLabel, formatDateIN, istDate, lintText, patientDocLabel, stripPhysician } from '@/core/copy'
import type { DatePrecision, Disclosure, DocType, Lang } from '@/core/types'
import { tp } from '@/i18n/patient'

export type HomeData = {
  /** Today in India time (YYYY-MM-DD, demo-clock aware): splits the written dates into coming up and earlier. */
  today: string
  documents: { id: string; docType: DocType | null; documentDate: string | null; receivedAt: string; disputed?: boolean; /** The signed consent form (or its withdrawal): shown by that name, never "Other document". */ consentForm?: 'sign' | 'withdraw' | null; /** The patient may open this paper's file. */ open?: boolean
    /** A file that holds several papers (E-DOC-10): each one's class and own date, in file order. */ reports?: { docType: DocType | null; documentDate: string | null }[]
    /** The patient asked the clinic for a copy (copies.ts): when, and when it was given. */ copy?: { at: string; givenAt?: string } | null }[]
  /** Production completeness items: a document type linked to a date, never a reason. */
  looking: {
    id: string; expectedTypes: DocType[]; state: 'expected' | 'requested' | 'received'
    date: string | null; precision: DatePrecision
    /** The hospital or lab that wrote the paper mentioning it (or the one the patient named): where to ask. */
    institution: string | null
    /** The paper that mentions it (type and its date), or null when the patient said it. */
    source?: { docType: DocType | null; date: string | null } | null
  }[]
  /** Follow-up dates already written in the papers ("Suture removal on 24/03/2026"), as written. */
  writtenDates: { id: string; what: string | null; date: string; precision: DatePrecision; docType: DocType | null }[]
  /** The doctor the latest papers name (Consultant / Referred by …), name only. */
  doctor: { name: string; docType: DocType | null; date: string | null } | null
  openRequests: number
  lastStatement: { at: string; confirmed: boolean } | null
  activeShares: number
}

export type WrittenDateRow = { id: string; date: string; what: string; source: string | null }

export type LookingRow = {
  id: string
  /** "Scan report", "Prescription": plain, no "/" alternatives and no "(printed)". */
  label: string
  /** "From around Apr 2026", or null when the paper gives no date. */
  when: string | null
  state: 'expected' | 'requested' | 'received'
  status: string
  /** "Ask at: City Care Hospital", or null when no hospital is known. */
  ask: string | null
  /** The patient can make a letter only while nothing has been asked for yet. */
  canLetter: boolean
  /** "Mentioned in your Discharge summary, 20 Jan 2026": tells look-alike cards apart. Null when the patient said it. */
  mentionedIn: string | null
  /** "At: City Care Hospital": the place the paper was mentioned or came from, for told-apart cards. Null when unknown. */
  place: string | null
}

export type HomeSummary = {
  documents: {
    id: string; label: string; dated: string | null; received: string; disputed: boolean; open: boolean; reports?: { label: string; dated: string | null }[]
    /** "You asked for a copy on …" or "The clinic gave a copy on …". */ copy: string | null
    /** A paper the patient cannot open, with no copy request waiting: they may ask the clinic for one. */ canAsk: boolean
  }[]
  looking: LookingRow[]
  /** Dates written in the papers that are today or later, soonest first. */
  coming: WrittenDateRow[]
  /** Dates already past, newest first (shown collapsed). */
  earlier: WrittenDateRow[]
  doctor: string | null
  requests: string
  visit: string
  shares: string
}

const unique = <T,>(xs: T[]) => [...new Set(xs)]

/** Server-originated free text (an institution name, a staff-typed document name) shown to a patient who has not been told. */
export function guardText(text: string | null | undefined, disclosure: Disclosure, fallback: string): string {
  const t = (text ?? '').trim()
  if (!t) return fallback
  return disclosure !== 'cleared' && lintText(t, ['diagnosis']).length ? fallback : t
}

/** "2 Nov 2026, 10:14" in India time. */
export function formatDateTimeIN(at: string | Date, lang: Lang): string {
  const ms = typeof at === 'string' ? Date.parse(at) : at.getTime()
  const iso = new Date(ms).toISOString()
  return `${formatDateIN(iso, lang)}, ${new Date(ms + 330 * 60_000).toISOString().slice(11, 16)}`
}

const MONTH_WORDS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const DATE_TOKENS = new RegExp(
  `\\b\\d{1,4}\\s*[/.-]\\s*\\d{1,2}\\s*[/.-]\\s*\\d{1,4}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_WORDS})\\.?,?\\s+\\d{2,4}\\b|\\b(?:${MONTH_WORDS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}\\b|\\b\\d{1,2}\\s*[/.]\\s*\\d{1,2}\\b`,
  'gi',
)
const EDGE = /^[\s\-—–:,;|()/.]+|[\s\-—–:,;|()/.]+$/g

/**
 * A label copied from a paper without the date written in it: "02/02/2026 — next visit" becomes "next visit", and a
 * label that was only a date becomes empty (the page then says "A date written in your papers").
 */
export function labelWithoutDates(text: string | null | undefined): string {
  let t = (text ?? '').replace(DATE_TOKENS, ' ').replace(/\s+/g, ' ').replace(EDGE, '')
  t = t.replace(/\b(?:on|at|by|dated?|from|till|until)\s*$/i, '').replace(EDGE, '').trim()
  return /\p{L}/u.test(t) && t.length >= 2 ? t : ''
}

/** Last day a written date can still mean: a month or a year is "coming up" until it is over. */
function endOfPeriod(date: string, precision: DatePrecision): string {
  const [y, m] = date.split('-').map(Number)
  if (precision === 'year') return `${y}-12-31`
  if (precision === 'month') return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  return date.slice(0, 10)
}

export const isPastDate = (date: string, precision: DatePrecision, today: string) => endOfPeriod(date, precision) < today

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Family members see "Prescription", never "Prescription (printed)" or "Prescription (handwritten)". */
function plainLabel(t: DocType, disclosure: Disclosure, lang: Lang): string {
  return t.startsWith('prescription') ? patientDocLabel('prescription_printed', 'not_cleared', lang) : patientDocLabel(t, disclosure, lang)
}

export function buildHomeSummary(d: HomeData, disclosure: Disclosure, lang: Lang): HomeSummary {
  // Newest paper first by the paper's own date (a file of several papers by its newest one); no date: the day it arrived.
  const newest = (x: HomeData['documents'][number]) => (x.reports ?? []).reduce<string | null>((m, r) => (r.documentDate && (!m || r.documentDate > m) ? r.documentDate : m), null)
  const sortKey = (x: HomeData['documents'][number]) => newest(x) ?? x.documentDate ?? istDate(x.receivedAt)
  const datedOn = (date: string | null) => (date ? tp(lang, 'docDatedOn', { date: formatDateIN(date, lang) }) : null)
  const documents = [...d.documents]
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || b.receivedAt.localeCompare(a.receivedAt))
    .map((x) => {
      // A file of several papers: each listed with its own date, newest first (undated last).
      const reports = !x.consentForm && x.reports && x.reports.length > 1
        ? [...x.reports].sort((a, b) => (b.documentDate ?? '').localeCompare(a.documentDate ?? ''))
          .map((r) => ({ label: r.docType ? plainLabel(r.docType, disclosure, lang) : tp(lang, 'docPending'), dated: datedOn(r.documentDate) }))
        : null
      return {
        id: x.id,
        label: x.consentForm ? consentFormLabel(lang, x.consentForm) : x.docType ? plainLabel(x.docType, disclosure, lang) : tp(lang, 'docPending'),
        dated: reports ? tp(lang, 'docPapersInFile', { n: reports.length }) : datedOn(x.documentDate),
        received: tp(lang, 'docReceivedOn', { date: formatDateIN(istDate(x.receivedAt), lang) }),
        disputed: !!x.disputed,
        open: !!x.open,
        ...(reports ? { reports } : {}),
        copy: x.copy ? tp(lang, x.copy.givenAt ? 'copyGiven' : 'copyAsked', { date: formatDateIN(istDate(x.copy.givenAt ?? x.copy.at), lang) }) : null,
        canAsk: !x.open && !x.consentForm && !(x.copy && !x.copy.givenAt),
      }
    })

  const looking: LookingRow[] = d.looking.map((x) => {
    const label = unique(x.expectedTypes.map((t) => plainLabel(t, disclosure, lang))).join(tp(lang, 'orJoin')) || tp(lang, 'reqPaperFallback')
    const where = guardText(x.institution, disclosure, '')
    return {
      id: x.id,
      label,
      when: x.date && x.precision !== 'unknown' ? tp(lang, 'lookingFrom', { date: formatDateIN(x.date, lang, x.precision) }) : null,
      state: x.state,
      status: tp(lang, `lookingStatus_${x.state}`),
      ask: where ? tp(lang, 'lookingAsk', { institution: where }) : null,
      canLetter: x.state === 'expected',
      place: where ? tp(lang, 'lookingAt', { institution: where }) : null,
      mentionedIn: x.source?.docType
        ? tp(lang, x.source.date ? 'lookingMentioned' : 'lookingMentionedNoDate', { label: plainLabel(x.source.docType, disclosure, lang), date: x.source.date ? formatDateIN(x.source.date, lang) : '' })
        : null,
    }
  })

  // Free text from a paper ("Review in the Surgical Oncology OPD") reaches a patient who has not been told only if it
  // carries no diagnosis words and no treatment cycle ("Next visit: Cycle 5"); otherwise the neutral fallback.
  const fallback = tp(lang, 'writtenDateFallback')
  type Row = WrittenDateRow & { iso: string; precision: DatePrecision; written: boolean }
  const rows: Row[] = d.writtenDates.map((x) => {
    const clean = labelWithoutDates(stripPhysician(x.what))
    const safe = disclosure !== 'cleared' && /\bcycles?\b/i.test(clean) ? '' : guardText(clean, disclosure, '')
    return {
      id: x.id, iso: x.date, precision: x.precision, written: !!safe,
      date: formatDateIN(x.date, lang, x.precision), what: safe || fallback,
      source: x.docType ? tp(lang, 'writtenFrom', { label: plainLabel(x.docType, disclosure, lang) }) : null,
    }
  })
  // One row per date and wording; a date with no wording of its own is dropped when another row for that date has one.
  const labelled = new Set(rows.filter((r) => r.written).map((r) => `${r.iso}|${r.precision}`))
  const seen = new Set<string>()
  const kept = rows.filter((r) => {
    if (!r.written && labelled.has(`${r.iso}|${r.precision}`)) return false
    const key = `${r.iso}|${r.precision}|${r.written ? norm(r.what) : ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const strip = ({ id, date, what, source }: Row): WrittenDateRow => ({ id, date, what, source })
  const coming = kept.filter((r) => !isPastDate(r.iso, r.precision, d.today)).sort((a, b) => a.iso.localeCompare(b.iso)).map(strip)
  const earlier = kept.filter((r) => isPastDate(r.iso, r.precision, d.today)).sort((a, b) => b.iso.localeCompare(a.iso)).map(strip)

  const doctorName = d.doctor ? guardText(d.doctor.name, disclosure, '') : ''
  const doctor = d.doctor && doctorName
    ? tp(lang, d.doctor.date ? 'doctorNamed' : 'doctorNamedNoDate', {
      name: doctorName,
      label: d.doctor.docType ? plainLabel(d.doctor.docType, disclosure, lang) : tp(lang, 'reqPaperFallback'),
      date: d.doctor.date ? formatDateIN(d.doctor.date, lang) : '',
    })
    : null

  const visit = !d.lastStatement
    ? tp(lang, 'visitNone')
    : tp(lang, d.lastStatement.confirmed ? 'visitDoneConfirmed' : 'visitDoneUnconfirmed', {
      date: formatDateIN(istDate(d.lastStatement.at), lang),
    })

  return {
    documents,
    looking,
    coming,
    earlier,
    doctor,
    requests: d.openRequests ? tp(lang, 'requestsOpen', { n: d.openRequests }) : tp(lang, 'requestsNone'),
    visit,
    shares: d.activeShares ? tp(lang, 'shareActiveCount', { n: d.activeShares }) : tp(lang, 'shareNone'),
  }
}
