// Pure builders for what the patient sees on the home page, plus small display helpers (FR-CON-07).
// Everything here takes data in and returns plain strings: unit-tested for zero diagnosis words (summary.test.ts).
import { formatDateIN, istDate, lintText, patientDocLabel } from '@/core/copy'
import type { DatePrecision, Disclosure, DocType, Lang } from '@/core/types'
import { tp } from '@/i18n/patient'

export type HomeData = {
  documents: { id: string; docType: DocType | null; documentDate: string | null; receivedAt: string; disputed?: boolean }[]
  /** Production completeness items: a document type linked to a date, never a reason. */
  looking: {
    id: string; expectedTypes: DocType[]; state: 'expected' | 'requested' | 'received'
    date: string | null; precision: DatePrecision
    /** The hospital or lab that wrote the paper mentioning it (or the one the patient named): where to ask. */
    institution: string | null
  }[]
  /** Follow-up dates already written in the papers ("Suture removal on 24/03/2026"), as written. */
  writtenDates: { id: string; what: string | null; date: string; precision: DatePrecision; docType: DocType | null }[]
  /** The doctor the latest papers name (Consultant / Referred by …), name only. */
  doctor: { name: string; docType: DocType | null; date: string | null } | null
  openRequests: number
  lastStatement: { at: string; confirmed: boolean } | null
  activeShares: number
}

export type HomeSummary = {
  documents: { id: string; label: string; dated: string | null; received: string; disputed: boolean }[]
  looking: { id: string; text: string; ask: string | null }[]
  writtenDates: { id: string; text: string; source: string | null }[]
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

export function buildHomeSummary(d: HomeData, disclosure: Disclosure, lang: Lang): HomeSummary {
  const documents = d.documents.map((x) => ({
    id: x.id,
    label: x.docType ? patientDocLabel(x.docType, disclosure, lang) : tp(lang, 'docPending'),
    dated: x.documentDate ? tp(lang, 'docDatedOn', { date: formatDateIN(x.documentDate, lang) }) : null,
    received: tp(lang, 'docReceivedOn', { date: formatDateIN(istDate(x.receivedAt), lang) }),
    disputed: !!x.disputed,
  }))

  const looking = d.looking.map((x) => {
    const label = unique(x.expectedTypes.map((t) => patientDocLabel(t, disclosure, lang))).join(' / ') || tp(lang, 'reqPaperFallback')
    const date = x.date ? formatDateIN(x.date, lang, x.precision) : null
    const suffix = x.state === 'expected' ? 'lookingNotInFile' : x.state === 'requested' ? 'lookingRequested' : 'lookingReceived'
    const where = guardText(x.institution, disclosure, '')
    return { id: x.id, text: tp(lang, date ? suffix : (`${suffix}NoDate` as typeof suffix), { label, date: date ?? '' }), ask: where ? tp(lang, 'lookingAsk', { institution: where }) : null }
  })

  // Free text from a paper ("Review in the Surgical Oncology OPD") reaches a patient who has not been told only if it
  // carries no diagnosis words and no treatment cycle ("Next visit: Cycle 5"); otherwise the neutral fallback.
  const fallback = tp(lang, 'writtenDateFallback')
  const writtenDates = d.writtenDates.map((x) => ({
    id: x.id,
    text: tp(lang, 'writtenDate', {
      what: disclosure !== 'cleared' && /\bcycles?\b/i.test(x.what ?? '') ? fallback : guardText(x.what, disclosure, fallback),
      date: formatDateIN(x.date, lang, x.precision),
    }),
    source: x.docType ? tp(lang, 'writtenFrom', { label: patientDocLabel(x.docType, disclosure, lang) }) : null,
  }))
  const doctorName = d.doctor ? guardText(d.doctor.name, disclosure, '') : ''
  const doctor = d.doctor && doctorName
    ? tp(lang, d.doctor.date ? 'doctorNamed' : 'doctorNamedNoDate', {
      name: doctorName,
      label: d.doctor.docType ? patientDocLabel(d.doctor.docType, disclosure, lang) : tp(lang, 'reqPaperFallback'),
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
    writtenDates,
    doctor,
    requests: d.openRequests ? tp(lang, 'requestsOpen', { n: d.openRequests }) : tp(lang, 'requestsNone'),
    visit,
    shares: d.activeShares ? tp(lang, 'shareActiveCount', { n: d.activeShares }) : tp(lang, 'shareNone'),
  }
}
