// Wording for a stored missing_records row. The row keeps rule id, trigger and grouped cycles, not the sentence, and
// runRadar stops emitting an item once its document is in file — so received/closed rows need the sentence rebuilt.
// Mirrors runRadar's wording (src/core/radar/index.ts); wording.test.ts asserts equality for every rule kind.
import { formatDateIN, patientDocLabel } from '@/core/copy'
import { formatCycleList, RADAR_RULES } from '@/core/radar'
import type { DatePrecision, DocType, FieldValue, Lang, LetterLang } from '@/core/types'
import { ts } from '@/i18n/shares'

export type L2 = { en: string; hi: string; hinglish?: string }

export type WordingTrigger = {
  kind: 'event' | 'statement'
  fields: Record<string, FieldValue>
  eventDate: string | null
  datePrecision: DatePrecision
  documentDate: string | null
  /** First evidence page of the trigger. */
  pageNo: number | null
  /** Type of the trigger's own document. */
  docType: DocType | null
}

const str = (v: FieldValue | undefined): string | null =>
  v === undefined ? null : Array.isArray(v) ? (v.length ? v.join(', ') : null) : String(v).trim() || null
const both = (f: (l: LetterLang) => string): L2 => ({ en: f('en'), hi: f('hi') })
const all3 = (f: (l: Lang) => string): Required<L2> => ({ en: f('en'), hi: f('hi'), hinglish: f('hinglish') })
const fill = (template: string, vars: Record<string, string>) => {
  const s = template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)
  return s.charAt(0).toUpperCase() + s.slice(1) // same as runRadar's fill
}

/** Cycle numbers from the stored `grouped` column (`[1,2,3]`, `{cycles}` or `[{cycles}]`). */
export function groupedCycles(grouped: unknown): number[] {
  const out: number[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object' && 'cycles' in v) walk((v as { cycles: unknown }).cycles)
  }
  walk(grouped)
  return [...new Set(out)].sort((a, b) => a - b)
}

/** Staff wording (administrative) and neutral wording (patient surfaces, FR-CON-07) for one stored item. */
export function missingWording(ruleId: string, expectedTypes: DocType[], t: WordingTrigger | null, cycles: number[]): { wording: L2; neutral: L2 } {
  const rule = RADAR_RULES.find((r) => r.id === ruleId)
  const first = expectedTypes[0] ?? 'other'
  if (!rule || !t) {
    const neutral = all3((l) => ts(l, 'absentFallback', { label: patientDocLabel(first, 'not_cleared', l) }))
    return { wording: both((l) => ts(l, 'absentFallback', { label: patientDocLabel(first, 'cleared', l) })), neutral }
  }
  const date = t.eventDate ?? t.documentDate
  const precision: DatePrecision = t.eventDate ? t.datePrecision : t.documentDate ? 'day' : 'unknown'
  const source = both((l) => {
    if (t.kind === 'statement') return l === 'en' ? 'patient statement' : 'मरीज़ का बयान'
    const label = t.docType ? patientDocLabel(t.docType, 'cleared', l) : l === 'en' ? 'record' : 'रिकॉर्ड'
    return t.pageNo ? `${label}, ${l === 'en' ? 'p.' : 'पृ.'}${t.pageNo}` : label
  })

  if (rule.kind === 'prior_cycles') {
    const n = cycles.length
    return {
      wording: both((l) => fill(rule.wording[l], { missing_list: formatCycleList(cycles), source_label: source[l], event_date: formatDateIN(date, l, precision) })),
      neutral: all3((l) => l === 'en'
        ? `${patientDocLabel('chemo_daycare_record', 'not_cleared', 'en')}s for ${n} earlier visit${n > 1 ? 's' : ''} not in file.`
        : l === 'hi'
          ? `पिछली ${n} विज़िट के ${patientDocLabel('chemo_daycare_record', 'not_cleared', 'hi')} फ़ाइल में नहीं हैं।`
          : `Pichhli ${n} visit ke ${patientDocLabel('chemo_daycare_record', 'not_cleared', 'hinglish')} file mein nahi hain.`),
    }
  }

  const institution = str(t.fields.referred_to_text) ?? str(t.fields.institution_name)
  const test = str(t.fields.test_name)
  return {
    wording: both((l) => fill(rule.wording[l], {
      event_date: formatDateIN(date, l, precision),
      source_label: source[l],
      test: test ?? (l === 'en' ? 'Test' : 'जाँच'),
      scan: str(t.fields.scan_name) ?? (l === 'en' ? 'scan' : 'स्कैन'),
      institution: institution ?? (l === 'en' ? 'another hospital' : 'दूसरे अस्पताल'),
    })),
    neutral: all3((l) => {
      const label = patientDocLabel(first, 'not_cleared', l)
      const d = formatDateIN(date, l, precision)
      return l === 'en' ? `${label} not in file for an item documented on ${d}.`
        : l === 'hi' ? `${d} को दर्ज एक प्रविष्टि के लिए ${label} फ़ाइल में नहीं है।`
          : `${d} ko darj ek entry ke liye ${label} file mein nahi hai.`
    }),
  }
}
