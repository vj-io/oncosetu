// ABDM FHIR R4 document bundles (NRCeS/ABDM profiles) → OncoSetu events (FR-ING-ABDM-02). Pure and deterministic.
// Server-only (uses the evidence gate's field rules, which hash with node:crypto).
//
//   DiagnosticReportRecord  each DiagnosticReport → imaging_report_documented (radiology category / imaging LOINC),
//                           pathology_report_documented (pathology category) or lab_report_documented (anything else)
//   DischargeSummaryRecord  Encounter.period.start → admission_documented, .end → discharge_documented,
//                           each Procedure → procedure_documented
//   OPConsultRecord         one consultation_documented (author, Encounter.serviceType, custodian, encounter date)
//   PrescriptionRecord      one prescription_documented: MedicationRequest names only (never dose or frequency)
//
// Values are copied, never inferred: names, titles, institutions and dates as the resource states them. Nothing is read
// from Condition (stage), Observation (grade, values), DiagnosticReport.conclusion or MedicationRequest.dosageInstruction,
// and every event passes the evidence gate's field rules (forbidden inference fields, per-type allow-list) before it is kept.
import { istDate } from '../copy'
import { runGate, type RejectReason } from '../gate'
import type { DatePrecision, DocType, EventType, FieldValue } from '../types'

export const HI_TYPES = ['DiagnosticReport', 'DischargeSummary', 'OPConsultation', 'Prescription'] as const
export type HiType = (typeof HI_TYPES)[number]

export const RECORD_TYPES = {
  DiagnosticReportRecord: { hiType: 'DiagnosticReport', snomed: '721981007' },
  DischargeSummaryRecord: { hiType: 'DischargeSummary', snomed: '373942005' },
  OPConsultRecord: { hiType: 'OPConsultation', snomed: '371530004' },
  PrescriptionRecord: { hiType: 'Prescription', snomed: '440545006' },
} as const satisfies Record<string, { hiType: HiType; snomed: string }>
export type RecordType = keyof typeof RECORD_TYPES

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const codings = (cc: unknown) => arr(obj(cc).coding).map(obj)
const codeText = (cc: unknown): string | null => str(obj(cc).text) ?? codings(cc).map((c) => str(c.display)).find(Boolean) ?? null

function personName(r: Obj | null): string | null {
  if (!r) return null
  const n = obj(arr(r.name)[0])
  return str(n.text) ?? (str([...arr(n.prefix), ...arr(n.given), n.family].filter((x) => typeof x === 'string').join(' ')))
}

export type FhirDate = { iso: string; precision: Exclude<DatePrecision, 'unknown'>; raw: string }
/** FHIR date / dateTime → calendar day (IST for a dateTime with a zone); partial dates keep their precision. */
export function fhirDate(v: unknown): FhirDate | null {
  const raw = str(v)
  const m = raw && /^(\d{4})(?:-(\d{2})(?:-(\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/.exec(raw)
  if (!m) return null
  const day = (iso: string) => (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null)
  if (m[3]) {
    const d = day(`${m[1]}-${m[2]}-${m[3]}`)
    if (!d) return null
    return { iso: m[4] && m[5] && !Number.isNaN(Date.parse(raw)) ? istDate(raw) : d, precision: 'day', raw }
  }
  if (m[2]) return day(`${m[1]}-${m[2]}-01`) ? { iso: `${m[1]}-${m[2]}-01`, precision: 'month', raw } : null
  return { iso: `${m[1]}-01-01`, precision: 'year', raw }
}

export type MappedEvent = {
  eventType: EventType
  fields: Record<string, FieldValue>
  eventDate: string | null
  datePrecision: DatePrecision
  dateFlags: string[]
  /** Evidence pointer: `DiagnosticReport/<id>`, `Procedure/<id>`, `Encounter/<id>`, `Composition/<id>#<section>`. */
  fhirRef: string
  /** The JSON the ref points at (hashed into the evidence row). */
  source: unknown
}
export type Rejected = { fhirRef: string; eventType: string; reason: RejectReason; detail?: string }
export type MapResult =
  | {
    ok: true; recordType: RecordType; hiType: HiType; docType: DocType; compositionId: string; title: string | null
    documentDate: string | null; institution: string | null; events: MappedEvent[]; rejected: Rejected[]
  }
  | { ok: false; reason: 'not_a_document_bundle' | 'no_composition' | 'unknown_record_type' }

const FIELD_RULES = new Set<RejectReason>(['unknown_event_type', 'event_type_not_extractable', 'forbidden_field', 'field_not_allowed', 'invalid_field_value'])

/**
 * The evidence gate's field rules for a structured event: forbidden inference fields (stage, grade, response, dose…),
 * the per-type allow-list and value types. The gate's quote stage does not apply (the source is a FHIR resource, not
 * page text), so the candidate carries no quote: the gate stops at `quote_too_short` exactly when every field rule passed.
 */
export function checkStructuredFields(eventType: string, fields: Record<string, unknown>): { ok: true } | { ok: false; reason: RejectReason; detail?: string } {
  const r = runGate([{ event_type: eventType, fields, quote: '' }], []).rejected[0]
  return r && FIELD_RULES.has(r.reason) ? { ok: false, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) } : { ok: true }
}

type Index = { get: (ref: unknown) => Obj | null; all: (type: string) => Obj[] }
function indexBundle(bundle: Obj): Index {
  const byKey = new Map<string, Obj>()
  const list: Obj[] = []
  for (const e of arr(bundle.entry).map(obj)) {
    const r = obj(e.resource)
    const type = str(r.resourceType)
    if (!type) continue
    list.push(r)
    const full = str(e.fullUrl)
    if (full) byKey.set(full, r)
    if (str(r.id)) byKey.set(`${type}/${r.id}`, r)
  }
  return {
    get: (ref) => {
      const key = str(obj(ref).reference) ?? str(ref)
      return key ? byKey.get(key) ?? byKey.get(key.split('/').slice(-2).join('/')) ?? null : null
    },
    all: (type) => list.filter((r) => r.resourceType === type),
  }
}

const refOf = (r: Obj, fallback: string) => `${String(r.resourceType)}/${str(r.id) ?? fallback}`
const sectionKey = (s: Obj, i: number) => codings(s.code).map((c) => str(c.code)).find(Boolean) ?? `section-${i + 1}`

function recordTypeOf(bundle: Obj, comp: Obj): RecordType | null {
  const names = Object.keys(RECORD_TYPES) as RecordType[]
  for (const p of [...arr(obj(comp.meta).profile), ...arr(obj(bundle.meta).profile)]) {
    const hit = names.find((n) => typeof p === 'string' && p.endsWith(`/StructureDefinition/${n}`))
    if (hit) return hit
  }
  const codes = codings(comp.type).map((c) => str(c.code))
  return names.find((n) => codes.includes(RECORD_TYPES[n].snomed)) ?? null
}

/** Category of a DiagnosticReport by its category codes (HL7 v2-0074, LOINC part codes) or an imaging LOINC code. */
const IMAGING_CATEGORY = new Set(['RAD', 'RX', 'CT', 'MR', 'US', 'NMR', 'NMS', 'VUS', 'RUS', 'XRC', 'CTH', 'LP29684-5'])
const PATHOLOGY_CATEGORY = new Set(['SP', 'PAT', 'CP', 'LP7839-6'])
const IMAGING_LOINC = new Set(['18748-4', '18726-0', '18782-3', '24627-2', '30746-2', '36643-5', '24558-9', '18755-9', '24531-6'])
export function reportKind(r: Obj): 'imaging' | 'pathology' | 'lab' {
  const cats = arr(r.category).flatMap(codings).map((c) => str(c.code)?.toUpperCase() ?? '')
  if (cats.some((c) => IMAGING_CATEGORY.has(c))) return 'imaging'
  if (cats.some((c) => PATHOLOGY_CATEGORY.has(c))) return 'pathology'
  if (codings(r.code).some((c) => str(c.system)?.includes('loinc') && IMAGING_LOINC.has(str(c.code) ?? ''))) return 'imaging'
  return 'lab'
}
const REPORT_EVENT = { imaging: 'imaging_report_documented', pathology: 'pathology_report_documented', lab: 'lab_report_documented' } as const
const REPORT_DOC: Record<'imaging' | 'pathology' | 'lab', DocType> = { imaging: 'imaging_report', pathology: 'pathology_report', lab: 'lab_report' }

/** The resource or section a stored `fhirRef` points at, for the source viewer. */
export function resolveRef(bundle: unknown, fhirRef: string): unknown {
  const b = obj(bundle)
  const [ref, section] = fhirRef.split('#')
  const r = indexBundle(b).get(ref)
  if (!r || !section) return r
  const s = arr(r.section).map(obj).find((x, i) => sectionKey(x, i) === section)
  return s ?? null
}

/** Maps one decrypted bundle. `now` (ISO) only adds `date_future` to dates after today (IST). */
export function mapBundle(input: unknown, opts: { now?: string } = {}): MapResult {
  const bundle = obj(input)
  if (bundle.resourceType !== 'Bundle' || bundle.type !== 'document') return { ok: false, reason: 'not_a_document_bundle' }
  const idx = indexBundle(bundle)
  const comp = obj(obj(arr(bundle.entry)[0]).resource)
  if (comp.resourceType !== 'Composition') return { ok: false, reason: 'no_composition' }
  const recordType = recordTypeOf(bundle, comp)
  if (!recordType) return { ok: false, reason: 'unknown_record_type' }

  const compId = str(comp.id) ?? 'composition'
  const custodian = str(idx.get(comp.custodian)?.name)
  const today = opts.now ? istDate(opts.now) : null
  const sections = arr(comp.section).map(obj)
  const sectionResources = (type: string) => {
    const seen = new Set<Obj>()
    for (const s of sections) for (const e of arr(s.entry)) { const r = idx.get(e); if (r?.resourceType === type) seen.add(r) }
    return seen.size ? [...seen] : idx.all(type)
  }
  const events: MappedEvent[] = []
  const rejected: Rejected[] = []
  const add = (eventType: EventType, raw: Record<string, FieldValue | null | undefined>, dateValue: unknown, fhirRef: string, source: unknown) => {
    const d = fhirDate(dateValue)
    const fields = Object.fromEntries(Object.entries({ ...raw, event_date_text: d?.raw }).filter(([, v]) => v != null && (!Array.isArray(v) || v.length))) as Record<string, FieldValue>
    const check = checkStructuredFields(eventType, fields)
    if (!check.ok) { rejected.push({ fhirRef, eventType, reason: check.reason, ...(check.detail ? { detail: check.detail } : {}) }); return }
    const dateFlags = !d ? ['date_unknown'] : today && d.iso > today ? ['date_future'] : []
    events.push({ eventType, fields, eventDate: d?.iso ?? null, datePrecision: d?.precision ?? 'unknown', dateFlags, fhirRef, source })
  }

  let docType: DocType
  if (recordType === 'DiagnosticReportRecord') {
    const reports = sectionResources('DiagnosticReport')
    docType = REPORT_DOC[reports[0] ? reportKind(reports[0]) : 'lab']
    reports.forEach((r, i) => {
      const performer = arr(r.performer).map((p) => idx.get(p)).find((p) => p?.resourceType === 'Organization')
      add(REPORT_EVENT[reportKind(r)], { test_name: codeText(r.code), institution_name: str(performer?.name) ?? custodian },
        r.effectiveDateTime ?? obj(r.effectivePeriod).start ?? r.issued ?? comp.date, refOf(r, String(i + 1)), r)
    })
  } else if (recordType === 'DischargeSummaryRecord') {
    docType = 'discharge_summary'
    const enc = idx.get(comp.encounter) ?? idx.all('Encounter')[0] ?? null
    if (enc) {
      const inst = str(idx.get(enc.serviceProvider)?.name) ?? custodian
      const period = obj(enc.period)
      if (period.start) add('admission_documented', { institution_name: inst }, period.start, refOf(enc, '1'), enc)
      if (period.end) add('discharge_documented', { institution_name: inst }, period.end, refOf(enc, '1'), enc)
    }
    sectionResources('Procedure').forEach((p, i) => add('procedure_documented', { procedure_text: codeText(p.code), institution_name: custodian },
      p.performedDateTime ?? obj(p.performedPeriod).start, refOf(p, String(i + 1)), p))
  } else if (recordType === 'OPConsultRecord') {
    docType = 'consult_note'
    const enc = idx.get(comp.encounter) ?? idx.all('Encounter')[0] ?? null
    const author = arr(comp.author).map((a) => idx.get(a)).find((a) => a?.resourceType === 'Practitioner') ?? null
    add('consultation_documented', { doctor_name: personName(author), department_text: enc ? codeText(enc.serviceType) : null, institution_name: custodian },
      (enc && obj(enc.period).start) ?? comp.date, enc ? refOf(enc, '1') : `Composition/${compId}`, enc ?? comp)
  } else {
    docType = 'prescription_printed' // structured, so never handwritten
    const i = sections.findIndex((s) => arr(s.entry).some((e) => idx.get(e)?.resourceType === 'MedicationRequest'))
    const meds = sectionResources('MedicationRequest')
    const names = [...new Set(meds.map((m) => codeText(m.medicationCodeableConcept) ?? codeText(idx.get(m.medicationReference)?.code)).filter((n): n is string => !!n))]
    const requester = meds.map((m) => idx.get(m.requester)).find((r) => r?.resourceType === 'Practitioner') ?? null
    add('prescription_documented', { medication_names: names, prescriber_name: personName(requester), institution_name: custodian },
      meds.map((m) => m.authoredOn).find(Boolean) ?? comp.date, i >= 0 ? `Composition/${compId}#${sectionKey(sections[i], i)}` : `Composition/${compId}`,
      i >= 0 ? { section: sections[i], resources: meds } : { resources: meds })
  }
  return {
    ok: true, recordType, hiType: RECORD_TYPES[recordType].hiType, docType, compositionId: compId, title: str(comp.title),
    documentDate: fhirDate(comp.date)?.iso ?? null, institution: custodian, events, rejected,
  }
}
