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
  }[]
  openRequests: number
  lastStatement: { at: string; confirmed: boolean } | null
  activeShares: number
}

export type HomeSummary = {
  documents: { id: string; label: string; dated: string | null; received: string; disputed: boolean }[]
  looking: { id: string; text: string }[]
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
    return { id: x.id, text: tp(lang, date ? suffix : (`${suffix}NoDate` as typeof suffix), { label, date: date ?? '' }) }
  })

  const visit = !d.lastStatement
    ? tp(lang, 'visitNone')
    : tp(lang, d.lastStatement.confirmed ? 'visitDoneConfirmed' : 'visitDoneUnconfirmed', {
      date: formatDateIN(istDate(d.lastStatement.at), lang),
    })

  return {
    documents,
    looking,
    requests: d.openRequests ? tp(lang, 'requestsOpen', { n: d.openRequests }) : tp(lang, 'requestsNone'),
    visit,
    shares: d.activeShares ? tp(lang, 'shareActiveCount', { n: d.activeShares }) : tp(lang, 'shareNone'),
  }
}
