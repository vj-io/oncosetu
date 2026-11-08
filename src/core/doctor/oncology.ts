// Oncology-ordered view of the facts already in the record, for the clinician overview.
// Pure and quote-only: it only regroups existing fact types in a fixed order. It never infers, scores or summarises.
import { STAFF_ONLY_EVENT_TYPES, type EventType } from '../types'

/** The part of a ledger item this grouping needs (a structural subset of the server's ItemView). */
export type FactItem = {
  id: string
  eventType: EventType
  headline: string | null
  status: string
  statusLabel: string
  fields: { key: string; label: string; value: string }[]
  sources: { docLabel: string; pageNo: number | null; quote: string; href: string | null }[]
  when: { event: string; eventIso: string | null }
}

export type Fact = {
  id: string
  /** What kind of fact (plain words, e.g. "Chemotherapy"). */
  kind: string
  /** The words of the document: a headline made of its own fields, or its quote. Never reworded. */
  text: string
  /** A staff-only line copied word for word (stage, markers, margins, diagnosis...): shown as a quote, never as a statement. */
  quoted: boolean
  quote: string | null
  where: string | null
  href: string | null
  dateLabel: string
  dateIso: string | null
  verified: boolean
}

export type OncologyView = {
  diagnosis: Fact[]
  stage: Fact[]
  markers: Fact[]
  margins: Fact[]
  treatment: Fact[]
  allergies: Fact[]
  medicines: Fact[]
  followUp: Fact[]
}

const KIND: Partial<Record<EventType, string>> = {
  procedure_documented: 'Procedure or surgery',
  chemotherapy_session_documented: 'Chemotherapy',
  radiotherapy_documented: 'Radiotherapy',
  imaging_report_documented: 'Imaging',
  impression_documented: 'Imaging impression',
  regimen_documented: 'Regimen',
  diagnosis_documented: 'Diagnosis',
  pathology_report_documented: 'Pathology report',
  molecular_test_documented: 'Test',
  marker_results_documented: 'Marker result',
  stage_documented: 'Stage',
  margins_documented: 'Margins',
  allergy_documented: 'Allergy',
  prescription_documented: 'Prescription',
  follow_up_documented: 'Follow-up',
}

const TREATMENT: ReadonlySet<EventType> = new Set<EventType>([
  'procedure_documented', 'chemotherapy_session_documented', 'radiotherapy_documented', 'imaging_report_documented', 'impression_documented', 'regimen_documented',
])

const LABEL_WORDS = new Set(['report', 'reported', 'date', 'of', 'scan', 'addendum', 'dated', 'collected', 'received', 'issued', 'on', 'reporting', 'printed', 'amended'])
const DATE_RE = /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/

/** A quote that is only a date line ("Report Date: 18/11/2024", "Date Reported: 22/01/2026", "Addendum Date: 30/01/2026"): it tells a doctor nothing. */
export function isDateOnlyQuote(q: string | null | undefined): boolean {
  if (!q || !DATE_RE.test(q)) return false
  const rest = q.replace(DATE_RE, ' ').toLowerCase().split(/[^a-z]+/).filter(Boolean)
  return rest.length <= 4 && rest.every((w) => LABEL_WORDS.has(w))
}

/** A bare heading as the whole quote ("HISTOPATHOLOGY"): nothing is said about the patient. */
export const isHeadingOnlyQuote = (q: string | null | undefined) => !!q && /^\s*[A-Za-z][A-Za-z-]{2,30}\s*$/.test(q)

const docOf = (i: { sources: { href: string | null }[] }) => i.sources.map((s) => /\/documents\/([0-9a-f-]{36})/i.exec(s.href ?? '')?.[1]).find(Boolean) ?? null
const NOISY_TYPES: ReadonlySet<EventType> = new Set<EventType>(['imaging_report_documented', 'pathology_report_documented', 'molecular_test_documented'])

type Noisy = { eventType: EventType; sources: { href: string | null; quote: string }[] }
const isNoise = (i: Noisy) => NOISY_TYPES.has(i.eventType) && i.sources.length > 0 && i.sources.every((s) => isDateOnlyQuote(s.quote) || isHeadingOnlyQuote(s.quote))

/**
 * Drops an imaging, pathology or test fact whose quote is only a date or a bare heading when the same document has a fact that says
 * something (an impression, margins, a marker result...). If it is the document's only fact it stays, so the document is not invisible.
 */
export function dropDateOnlyImaging<T extends Noisy>(items: readonly T[]): T[] {
  const useful = new Set(items.filter((i) => !isNoise(i)).map(docOf).filter(Boolean))
  return items.filter((i) => !(isNoise(i) && useful.has(docOf(i))))
}

const firstQuote = (i: FactItem) => i.sources.find((s) => s.quote)

export function toFact(i: FactItem): Fact {
  const q = firstQuote(i)
  const text = (i.headline ?? '').trim() || q?.quote.trim() || i.fields.map((f) => f.value).filter(Boolean).join(' · ') || '—'
  const src = i.sources[0]
  return {
    id: i.id,
    kind: KIND[i.eventType] ?? 'Fact',
    text,
    quoted: STAFF_ONLY_EVENT_TYPES.has(i.eventType),
    quote: q?.quote.trim() ?? null,
    where: src ? `${src.docLabel}${src.pageNo ? `, p.${src.pageNo}` : ''}` : null,
    href: src?.href ?? null,
    dateLabel: i.when.event,
    dateIso: i.when.eventIso,
    verified: i.status === 'verified_matches_source' || i.status === 'edited',
  }
}

/** Oldest first, undated last, stable on id. */
export const byDateAsc = (a: Fact, b: Fact) => {
  if (a.dateIso !== b.dateIso) return a.dateIso === null ? 1 : b.dateIso === null ? -1 : a.dateIso < b.dateIso ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Newest first, undated last. */
const byDateDesc = (a: Fact, b: Fact) => {
  if (a.dateIso !== b.dateIso) return a.dateIso === null ? 1 : b.dateIso === null ? -1 : a.dateIso > b.dateIso ? -1 : 1
  return a.id < b.id ? -1 : 1
}

/**
 * Order: diagnosis and histopathology, stage as written, receptor/IHC results as written, margins as written,
 * treatment timeline (surgery, chemotherapy cycles, radiotherapy, imaging), allergies, medicines, follow-up dates.
 * Rejected items never reach the ledger view, so everything given here is current.
 */
export function oncologyView(all: readonly FactItem[]): OncologyView {
  const items = dropDateOnlyImaging(all)
  const of = (...t: EventType[]) => items.filter((i) => t.includes(i.eventType)).map(toFact)
  return {
    diagnosis: of('diagnosis_documented', 'pathology_report_documented').sort(byDateDesc),
    stage: of('stage_documented').sort(byDateDesc),
    markers: of('marker_results_documented', 'molecular_test_documented').sort(byDateDesc),
    margins: of('margins_documented').sort(byDateDesc),
    treatment: items.filter((i) => TREATMENT.has(i.eventType)).map(toFact).sort(byDateAsc),
    allergies: of('allergy_documented').sort(byDateDesc),
    medicines: of('prescription_documented').sort(byDateDesc),
    followUp: of('follow_up_documented').sort(byDateAsc),
  }
}

export const isEmptyOncology = (v: OncologyView) => Object.values(v).every((x) => x.length === 0)
