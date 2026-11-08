// Patient/staff copy helpers (FR-CON-07, FR-VOX-06). Pure, client-safe.
import type { DatePrecision, Disclosure, DocType, Lang } from '../types'

export { DIAGNOSIS_WORDS, JUDGEMENT_WORDS, LEGAL_BANNED, LETTER_BANNED, RADAR_BANNED, lintText } from './banned'
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

/** Hinglish neutral labels; cleared Hinglish uses the English clinical names (as people say them). */
const NEUTRAL_HINGLISH: Record<DocType, string> = {
  pathology_report: 'Lab report (tissue)',
  ihc_molecular_report: 'Lab report (aur tests)',
  imaging_report: 'Scan report',
  lab_report: 'Lab report',
  prescription_printed: 'Parcha',
  prescription_handwritten: 'Parcha (haath se likha)',
  discharge_summary: 'Hospital discharge summary',
  consult_note: 'Doctor visit note',
  chemo_daycare_record: 'Day-care record',
  radiotherapy_summary: 'Treatment summary',
  procedure_note: 'Procedure note',
  bill_insurance: 'Bill / insurance kaagaz',
  other: 'Doosra kaagaz',
}

export function patientDocLabel(docType: DocType, disclosure: Disclosure, lang: Lang = 'en'): string {
  if (lang === 'hinglish') return disclosure === 'cleared' ? CLEARED[docType].en : NEUTRAL_HINGLISH[docType]
  return (disclosure === 'cleared' ? CLEARED : NEUTRAL)[docType][lang]
}

export function staffDocLabel(docType: DocType): string {
  return CLEARED[docType].en
}

/** The HTML `lang` value: Hinglish is Hindi written in Latin script. */
export const htmlLang = (lang: Lang): string => (lang === 'hinglish' ? 'hi-Latn' : lang)

/** One string from an { en, hi, hinglish? } pair; Hinglish falls back to English where none was written (older rows). */
export function inLang(x: { en: string; hi: string; hinglish?: string }, lang: Lang): string {
  return lang === 'hinglish' ? x.hinglish ?? x.en : x[lang]
}

/** "OncoSetu" contains "Onco", so non-cleared patient surfaces show "Setu Records". */
export function brandFor(disclosure: Disclosure): 'OncoSetu' | 'Setu Records' {
  return disclosure === 'cleared' ? 'OncoSetu' : 'Setu Records'
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS: Record<Lang, string[]> = {
  en: EN_MONTHS,
  hinglish: EN_MONTHS,
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
  if (!iso || precision === 'unknown') return lang === 'hi' ? 'तारीख़ दर्ज नहीं' : lang === 'hinglish' ? 'tareekh likhi nahi' : 'date not stated'
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
