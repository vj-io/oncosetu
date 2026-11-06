// Patient/staff copy helpers (FR-CON-07, FR-VOX-06). Pure, client-safe.
import type { DatePrecision, Disclosure, DocType, Lang } from '../types'

export { DIAGNOSIS_WORDS, LEGAL_BANNED, LETTER_BANNED, RADAR_BANNED, lintText } from './banned'
export type { LintHit, Ruleset } from './banned'

type Label = { en: string; hi: string }

/** Clinical labels: staff UI, and patient surfaces only when disclosure is `cleared`. */
const CLEARED: Record<DocType, Label> = {
  pathology_report: { en: 'Histopathology report', hi: 'हिस्टोपैथोलॉजी रिपोर्ट' },
  ihc_molecular_report: { en: 'IHC / molecular report', hi: 'आईएचसी / मॉलिक्यूलर रिपोर्ट' },
  imaging_report: { en: 'Imaging report', hi: 'इमेजिंग रिपोर्ट' },
  lab_report: { en: 'Lab report', hi: 'लैब रिपोर्ट' },
  prescription_printed: { en: 'Prescription (printed)', hi: 'पर्चा (छपा हुआ)' },
  prescription_handwritten: { en: 'Prescription (handwritten)', hi: 'पर्चा (हाथ से लिखा)' },
  discharge_summary: { en: 'Discharge summary', hi: 'डिस्चार्ज सारांश' },
  consult_note: { en: 'Consultation note', hi: 'परामर्श नोट' },
  chemo_daycare_record: { en: 'Chemotherapy day-care record', hi: 'कीमोथेरेपी डे-केयर रिकॉर्ड' },
  radiotherapy_summary: { en: 'Radiotherapy summary', hi: 'रेडियोथेरेपी सारांश' },
  procedure_note: { en: 'Procedure / operative note', hi: 'प्रक्रिया / ऑपरेशन नोट' },
  bill_insurance: { en: 'Bill / insurance document', hi: 'बिल / बीमा दस्तावेज़' },
  other: { en: 'Other document', hi: 'अन्य दस्तावेज़' },
}

/** Neutral labels: patient surfaces unless disclosure is `cleared` (no diagnosis/treatment-class words). */
const NEUTRAL: Record<DocType, Label> = {
  pathology_report: { en: 'Laboratory report (tissue)', hi: 'प्रयोगशाला रिपोर्ट (ऊतक)' },
  ihc_molecular_report: { en: 'Laboratory report (additional tests)', hi: 'प्रयोगशाला रिपोर्ट (अतिरिक्त जाँच)' },
  imaging_report: { en: 'Scan report', hi: 'स्कैन रिपोर्ट' },
  lab_report: { en: 'Laboratory report', hi: 'प्रयोगशाला रिपोर्ट' },
  prescription_printed: { en: 'Prescription', hi: 'पर्चा' },
  prescription_handwritten: { en: 'Prescription (handwritten)', hi: 'पर्चा (हाथ से लिखा)' },
  discharge_summary: { en: 'Hospital discharge summary', hi: 'अस्पताल डिस्चार्ज सारांश' },
  consult_note: { en: "Doctor's visit note", hi: 'डॉक्टर विज़िट नोट' },
  chemo_daycare_record: { en: 'Day-care record', hi: 'डे-केयर रिकॉर्ड' },
  radiotherapy_summary: { en: 'Treatment summary', hi: 'उपचार सारांश' },
  procedure_note: { en: 'Procedure note', hi: 'प्रक्रिया नोट' },
  bill_insurance: { en: 'Bill / insurance document', hi: 'बिल / बीमा दस्तावेज़' },
  other: { en: 'Other document', hi: 'अन्य दस्तावेज़' },
}

export function patientDocLabel(docType: DocType, disclosure: Disclosure, lang: Lang = 'en'): string {
  return (disclosure === 'cleared' ? CLEARED : NEUTRAL)[docType][lang]
}

export function staffDocLabel(docType: DocType): string {
  return CLEARED[docType].en
}

/** "OncoSetu" contains "Onco", so non-cleared patient surfaces show "Setu Records". */
export function brandFor(disclosure: Disclosure): 'OncoSetu' | 'Setu Records' {
  return disclosure === 'cleared' ? 'OncoSetu' : 'Setu Records'
}

const MONTHS: Record<Lang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
}

const IST_OFFSET_MS = 330 * 60_000

/** Calendar date (YYYY-MM-DD) of an ISO date or timestamp; timestamps are read in IST. */
export function istDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  return new Date(Date.parse(iso) + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** "12 Mar 2026" / "12 मार्च 2026"; month precision → "Mar 2026"; year → "2026"; null → "date not stated". */
export function formatDateIN(iso: string | null | undefined, lang: Lang = 'en', precision: DatePrecision = 'day'): string {
  if (!iso || precision === 'unknown') return lang === 'hi' ? 'तारीख़ दर्ज नहीं' : 'date not stated'
  const [y, m, d] = istDate(iso).split('-').map(Number)
  if (precision === 'year') return String(y)
  const month = MONTHS[lang][m - 1]
  return precision === 'month' ? `${month} ${y}` : `${d} ${month} ${y}`
}

/** Hindi when an Accept-Language header lists it before English, else English. */
export function langFromAcceptLanguage(header: string | null): Lang {
  for (const tag of (header ?? '').split(',').map((p) => p.split(';')[0].trim().toLowerCase())) {
    if (tag === 'hi' || tag.startsWith('hi-')) return 'hi'
    if (tag === 'en' || tag.startsWith('en-')) return 'en'
  }
  return 'en'
}
