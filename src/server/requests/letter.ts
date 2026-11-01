// The records request letter (FR-REQ-01/02) as plain strings, so the print page renders exactly what the lint test
// checks. The patient carries this paper: neutral document labels and the "Setu Records" brand unless disclosure
// is cleared, and any free text that would disclose the diagnosis becomes a blank line to fill in by hand.
import { brandFor, formatDateIN, lintText, patientDocLabel } from '@/core/copy'
import { DOC_TYPES, type Disclosure, type DocType, type Lang } from '@/core/types'
import { tr } from '@/i18n/requests'

/** Request document keys: the 13 document types plus "indoor (in-patient) case records". */
export const REQUEST_DOC_KEYS = [...DOC_TYPES, 'inpatient_records'] as const
export type RequestDocKey = (typeof REQUEST_DOC_KEYS)[number]
/** Default scope: the categories the regulation and case law most clearly cover (FR-REQ-01). */
export const DEFAULT_REQUEST_DOCS: RequestDocKey[] = ['discharge_summary', 'inpatient_records', 'pathology_report', 'imaging_report']

export function requestDocLabel(key: string, disclosure: Disclosure, lang: Lang): string | null {
  if (key === 'inpatient_records') return tr(lang, 'inpatient_records')
  return (DOC_TYPES as readonly string[]).includes(key) ? patientDocLabel(key as DocType, disclosure, lang) : null
}

/** Free text from staff or the patient, printed for a patient who may not have been told: blank if it names the diagnosis. */
export function guardFree(text: string | null | undefined, disclosure: Disclosure): string | null {
  const t = (text ?? '').trim()
  if (!t) return null
  return disclosure !== 'cleared' && lintText(t, ['diagnosis']).length ? null : t
}

export type LetterInput = {
  lang: Lang
  disclosure: Disclosure
  requestId: string
  patient: { name: string; dob: string | null }
  institution: string
  institutionPatientId: string | null
  documents: string[]
  dateRange: { from?: string; to?: string } | null
  /** YYYY-MM-DD (IST) */
  today: string
}

export type Letter = {
  lang: Lang; brand: string; title: string; date: string
  to: { dept: string; institution: string | null; blankLabel: string }
  subject: string; salutation: string; intro: string; documents: string[]
  patient: { label: string; value: string | null }[]
  period: string; reference: string; returnText: string; qrCaption: string; thanks: string
  sign: string[]; footer: string
}

export function buildLetter(i: LetterInput): Letter {
  const { lang: l, disclosure } = i
  const brand = brandFor(disclosure)
  const from = i.dateRange?.from ? formatDateIN(i.dateRange.from, l) : null
  const to = i.dateRange?.to ? formatDateIN(i.dateRange.to, l) : null
  const period = from && to ? tr(l, 'letterPeriod', { from, to }) : from ? tr(l, 'letterPeriodFrom', { from }) : to ? tr(l, 'letterPeriodTo', { to }) : tr(l, 'letterPeriodAll')
  return {
    lang: l, brand,
    title: tr(l, 'letterTitle'),
    date: tr(l, 'letterDate', { date: formatDateIN(i.today, l) }),
    to: { dept: tr(l, 'letterDept'), institution: guardFree(i.institution, disclosure), blankLabel: tr(l, 'letterInstitutionBlank') },
    subject: tr(l, 'letterSubject'),
    salutation: tr(l, 'letterSalutation'),
    intro: tr(l, 'letterIntro'),
    documents: [...new Set(i.documents.map((d) => requestDocLabel(d, disclosure, l)).filter((x): x is string => !!x))],
    patient: [
      { label: tr(l, 'letterPatient'), value: i.patient.name },
      { label: tr(l, 'letterDob'), value: i.patient.dob ? formatDateIN(i.patient.dob, l) : null },
      { label: tr(l, 'letterUhid'), value: guardFree(i.institutionPatientId, disclosure) },
    ],
    period,
    reference: tr(l, 'letterReference'),
    returnText: tr(l, 'letterReturn'),
    qrCaption: tr(l, 'letterQrCaption'),
    thanks: tr(l, 'letterThanks'),
    sign: [tr(l, 'letterSign'), tr(l, 'letterSignName'), tr(l, 'letterSignRelation'), tr(l, 'letterSignDate')],
    footer: tr(l, 'letterFooter', { ref: i.requestId.replace(/-/g, '').slice(-8).toUpperCase(), brand }),
  }
}

/** Every printed word of the letter, in reading order (what the lint test checks). */
export function letterText(x: Letter): string {
  return [
    x.brand, x.title, x.date, tr(x.lang, 'letterTo'), x.to.dept, x.to.institution ?? x.to.blankLabel, x.subject, x.salutation, x.intro,
    ...x.documents, ...x.patient.flatMap((p) => [p.label, p.value ?? '']), x.period, x.reference, x.returnText, x.qrCaption, x.thanks,
    ...x.sign, x.footer,
  ].join('\n')
}
