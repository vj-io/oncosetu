// Oncology-ordered view of the facts already in the record, for the clinician overview.
// Pure and quote-only: it only regroups existing fact types in a fixed order. It never infers, scores or summarises.
import type { EventType } from '../types'

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

/** A quote that is only a date line ("Report Date: 18/11/2024", "Date of Scan: 20/02/2026"): it tells a doctor nothing. */
export const isDateOnlyQuote = (q: string | null | undefined) => !!q && /^\s*(?:report\s+date|date\s+of\s+(?:scan|report)|date|dated)?\s*[:\-]?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s*$/i.test(q)

const docOf = (i: { sources: { href: string | null }[] }) => i.sources.map((s) => /\/documents\/([0-9a-f-]{36})/i.exec(s.href ?? '')?.[1]).find(Boolean) ?? null

/** Drops an imaging fact whose quote is only a date when the same document also gives an impression: the impression row says more. */
export function dropDateOnlyImaging<T extends { eventType: EventType; sources: { href: string | null; quote: string }[] }>(items: readonly T[]): T[] {
  const withImpression = new Set(items.filter((i) => i.eventType === 'impression_documented').map(docOf).filter(Boolean))
  return items.filter((i) => !(i.eventType === 'imaging_report_documented' && i.sources.length > 0 && i.sources.every((s) => isDateOnlyQuote(s.quote)) && withImpression.has(docOf(i))))
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
