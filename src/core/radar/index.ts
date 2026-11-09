// Missing-Record Radar engine (FR-RAD-01..05, E-RAD-01..04). Pure and deterministic: same input → same output,
// regardless of input order. Speaks only about documents.
import { formatDateIN, istDate, patientDocLabel } from '../copy'
import { dateRange, addDays } from '../dates'
import { sha256Hex } from '../hash'
import type { CoreDocument, CoreEvent, CoreStatement, DatePrecision, DocType, FieldValue, Lang, LetterLang, MissingState } from '../types'
import { RADAR_RULES, type RadarRule } from './rules'

export { RADAR_RULES, RULES_YAML, loadRules, RuleSchema, type RadarRule } from './rules'

export type RuleMode = 'production' | 'shadow'

export interface RadarInput {
  events: CoreEvent[]
  documents: CoreDocument[]
  statements: CoreStatement[]
  /** Per-org mode from `rule_states`: a `production` row exists only after a clinician review was recorded for that org (FR-RAD-05). Absent → the YAML `clinician_reviewed` default. */
  ruleModes?: Record<string, RuleMode>
  /** ISO timestamp or date; triggers dated after now are ignored. */
  now: string
  rules?: readonly RadarRule[]
}

export interface RadarItem {
  dedupeKey: string
  ruleId: string
  ruleVersion: number
  triggerEventId: string
  triggerKind: 'event' | 'statement'
  expectedTypes: DocType[]
  window: { from: string | null; to: string | null }
  /** Staff wording (administrative only). */
  wording: { en: string; hi: string }
  /** Patient-surface wording: neutral labels, no diagnosis/treatment-class words (FR-CON-07). */
  neutralWording: { en: string; hi: string; hinglish: string }
  sourceLabel: string
  mode: RuleMode
  grouped?: { cycles: number[] }
}

export interface ClosureProposal {
  dedupeKey: string
  documentId: string
  note?: 'institution_differs' | 'document_date_unknown'
}

export interface RadarOutput {
  items: RadarItem[]
  closureProposals: ClosureProposal[]
}

/** Stable dedupe key: sha256(ruleId:trigger) truncated to 32 hex chars. */
export const dedupeKeyFor = (ruleId: string, trigger: string) => sha256Hex(`${ruleId}:${trigger}`).slice(0, 32)

// ---------- normalised triggers ----------

interface Trigger {
  id: string
  kind: 'event' | 'statement'
  eventType: string
  fields: Record<string, FieldValue>
  date: string | null
  precision: DatePrecision
  documentId: string | null
  pageNo: number | null
  institution: string | null
}

const str = (v: FieldValue | undefined): string | null =>
  v === undefined ? null : Array.isArray(v) ? (v.length ? v.join(', ') : null) : String(v).trim() || null

function wordMatch(text: string, kw: string): boolean {
  const lead = kw.startsWith('*')
  const trail = kw.endsWith('*')
  const body = kw.replace(/^\*|\*$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const L = '[\\p{L}\\p{M}\\p{N}]'
  return new RegExp(`(?<!${L})${lead ? `${L}*` : ''}${body}${trail ? `${L}*` : ''}(?!${L})`, 'iu').test(text)
}

function triggerMatches(rule: RadarRule, t: Trigger): boolean {
  if (rule.trigger.event_type !== t.eventType) return false
  for (const f of rule.trigger.required_fields) {
    if (f === 'event_date' ? !t.date : !str(t.fields[f])) return false
  }
  const any = rule.trigger.keywords_any
  if (any && !Object.entries(any).some(([f, kws]) => kws.some((k) => wordMatch(str(t.fields[f]) ?? '', k)))) return false
  const none = rule.trigger.keywords_none
  if (none && Object.entries(none).some(([f, kws]) => kws.some((k) => wordMatch(str(t.fields[f]) ?? '', k)))) return false
  return true
}

/** RAD-PEND-01: expected document type from the pending test's name. */
function typesFromTest(test: string): DocType[] {
  if (/\b(?:ihc|immunohisto\w*|ngs|egfr|alk|ros-?1|kras|braf|brca\w*|pd-?l1|msi|fish|pcr|molecular)\b/i.test(test)) return ['ihc_molecular_report']
  if (/\b(?:hpe|histopath\w*|biopsy|cytology|fnac|frozen|pathology|bone\s+marrow)\b/i.test(test)) return ['pathology_report']
  if (/\b(?:pet|ct|cect|ncct|mri|usg|ultrasound|ultrasonography|x-?ray|mammo\w*|scan|echo|muga)\b/i.test(test)) return ['imaging_report']
  return ['lab_report']
}

const normInst = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !['the', 'of', 'and', 'pvt', 'ltd', 'private', 'limited'].includes(w)).join(' ')
const sameInstitution = (a: string, b: string) => {
  const x = normInst(a)
  const y = normInst(b)
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}

function lang<T>(f: (l: LetterLang) => T): { en: T; hi: T } {
  return { en: f('en'), hi: f('hi') }
}

function fill(template: string, vars: Record<string, string>): string {
  const s = template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)
  return s.charAt(0).toUpperCase() + s.slice(1) // "{test} report …" with a test written in lower case ("laboratory")
}

/** "1–3, 5" */
export function formatCycleList(cycles: number[]): string {
  const sorted = [...new Set(cycles)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]))
    i = j
  }
  return parts.join(', ')
}

// ---------- engine ----------

/** Runs every rule over the current record. Items = expected documents not in file; closureProposals = triggers whose document is now in file (a person confirms). */
export function runRadar(input: RadarInput): RadarOutput {
  const rules = [...(input.rules ?? RADAR_RULES)].sort((a, b) => a.id.localeCompare(b.id))
  const today = istDate(input.now)
  const docs = [...input.documents].filter((d) => !d.detachedAt).sort((a, b) => a.id.localeCompare(b.id))
  const docById = new Map(docs.map((d) => [d.id, d]))
  const superseded = new Set(input.events.map((e) => e.supersedesId).filter(Boolean) as string[])

  const triggers: Trigger[] = [
    ...input.events
      .filter((e) => e.verificationStatus !== 'rejected' && !superseded.has(e.id) && (!e.documentId || docById.has(e.documentId)))
      .map((e): Trigger => {
        const date = e.eventDate ?? e.documentDate
        return {
          id: e.id,
          kind: 'event',
          eventType: e.eventType,
          fields: e.fields,
          date,
          precision: e.eventDate ? e.datePrecision : (e.documentDate ? 'day' : 'unknown'),
          documentId: e.documentId,
          pageNo: e.evidence[0]?.pageNo ?? null,
          institution: str(e.fields.institution_name) ?? (e.documentId ? docById.get(e.documentId)?.institution ?? null : null),
        }
      }),
    ...input.statements.map((s): Trigger => {
      const fields: Record<string, FieldValue> = { statement_text: s.transcript }
      if (s.scanNames?.length) fields.scan_name = s.scanNames
      if (s.medicationNames?.length) fields.medication_names = s.medicationNames
      if (s.institutionName) fields.institution_name = s.institutionName
      return { id: s.id, kind: 'statement', eventType: 'patient_statement', fields, date: s.statedDate ?? istDate(s.capturedAt), precision: 'day', documentId: null, pageNo: null, institution: s.institutionName ?? null }
    }),
  ]
    .filter((t) => !t.date || t.date <= today)
    .sort((a, b) => a.id.localeCompare(b.id))

  const items: RadarItem[] = []
  const closureProposals: ClosureProposal[] = []

  for (const rule of rules) {
    const mode: RuleMode = input.ruleModes?.[rule.id] ?? (rule.clinician_reviewed ? 'production' : 'shadow')
    const matching = triggers.filter((t) => triggerMatches(rule, t))

    const sourceLabel = (t: Trigger) =>
      lang((l) => {
        if (t.kind === 'statement') return l === 'en' ? 'patient statement' : 'मरीज़ का बयान'
        const d = t.documentId ? docById.get(t.documentId) : undefined
        const label = d ? patientDocLabel(d.docType, 'cleared', l) : l === 'en' ? 'record' : 'रिकॉर्ड'
        return t.pageNo ? `${label}, ${l === 'en' ? 'p.' : 'पृ.'}${t.pageNo}` : label
      })
    const neutral = (types: DocType[], t: Trigger) => {
      const label = (l: Lang) => patientDocLabel(types[0], 'not_cleared', l)
      const date = (l: Lang) => formatDateIN(t.date, l, t.precision)
      return {
        en: `${label('en')} not in file for an item documented on ${date('en')}.`,
        hi: `${date('hi')} को दर्ज एक प्रविष्टि के लिए ${label('hi')} फ़ाइल में नहीं है।`,
        hinglish: `${date('hinglish')} ko darj ek entry ke liye ${label('hinglish')} file mein nahi hai.`,
      }
    }

    if (rule.kind === 'prior_cycles') {
      const cycleOf = (t: Trigger) => {
        const n = parseInt(str(t.fields.cycle_number) ?? '', 10)
        return Number.isFinite(n) && n > 0 ? n : null
      }
      // ponytail: one group per patient; cycle numbering that restarts with a new regimen needs regimen-aware grouping.
      const withCycle = matching.filter((t) => cycleOf(t) !== null)
      if (!withCycle.length) continue
      const max = Math.max(...withCycle.map((t) => cycleOf(t)!))
      if (max <= 1) continue
      const fromRecord = withCycle.filter((t) => t.documentId && rule.expects.document_types.includes(docById.get(t.documentId)!.docType))
      const present = new Set(fromRecord.map((t) => cycleOf(t)!))
      const missing = Array.from({ length: max - 1 }, (_, i) => i + 1).filter((c) => !present.has(c))
      const trigger = withCycle.filter((t) => cycleOf(t) === max).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id))[0]
      const dedupeKey = dedupeKeyFor(rule.id, 'patient')
      if (!missing.length) {
        const latest = fromRecord.filter((t) => cycleOf(t)! < max).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id))[0]
        if (latest?.documentId) closureProposals.push({ dedupeKey, documentId: latest.documentId })
        continue
      }
      const src = sourceLabel(trigger)
      const missingList = formatCycleList(missing)
      items.push({
        dedupeKey,
        ruleId: rule.id,
        ruleVersion: rule.version,
        triggerEventId: trigger.id,
        triggerKind: trigger.kind,
        expectedTypes: [...rule.expects.document_types],
        window: { from: null, to: trigger.date },
        wording: lang((l) => fill(rule.wording[l], { missing_list: missingList, source_label: src[l], event_date: formatDateIN(trigger.date, l, trigger.precision) })),
        neutralWording: {
          ...lang((l) =>
            l === 'en'
              ? `${patientDocLabel('chemo_daycare_record', 'not_cleared', 'en')}s for ${missing.length} earlier visit${missing.length > 1 ? 's' : ''} not in file.`
              : `पिछली ${missing.length} विज़िट के ${patientDocLabel('chemo_daycare_record', 'not_cleared', 'hi')} फ़ाइल में नहीं हैं।`,
          ),
          hinglish: `Pichhli ${missing.length} visit ke ${patientDocLabel('chemo_daycare_record', 'not_cleared', 'hinglish')} file mein nahi hain.`,
        },
        sourceLabel: src.en,
        mode,
        grouped: { cycles: missing },
      })
      continue
    }

    for (const t of matching) {
      if (!t.date) continue
      const test = str(t.fields.test_name)
      const expectedTypes = rule.expects.document_types_from_test && test ? typesFromTest(test).filter((d) => rule.expects.document_types.includes(d)) : [...rule.expects.document_types]
      if (!expectedTypes.length) continue
      const [tStart, tEnd] = dateRange(t.date, t.precision)
      const window = { from: addDays(tStart, rule.expects.window_days[0]), to: addDays(tEnd, rule.expects.window_days[1]) }
      const dedupeKey = dedupeKeyFor(rule.id, t.id)

      // Own document of an expected type satisfies the rule (e.g. admission documented inside a discharge summary).
      const own = t.documentId ? docById.get(t.documentId) : undefined
      let match: ClosureProposal | null = own && expectedTypes.includes(own.docType) ? { dedupeKey, documentId: own.id } : null
      if (!match) {
        const candidates = docs
          .filter((d) => expectedTypes.includes(d.docType))
          .map((d) => {
            const dated = !!d.documentDate
            const [ds, de] = dated ? dateRange(d.documentDate!, d.datePrecision ?? 'day') : ['', '']
            const inWindow = !dated || (de >= window.from && ds <= window.to)
            const differs = rule.expects.same_institution_preferred && !!t.institution && !!d.institution && !sameInstitution(t.institution, d.institution)
            return { d, dated, inWindow, differs, dist: dated ? Math.abs(Date.parse(ds) - Date.parse(tStart)) : Infinity }
          })
          .filter((c) => c.inWindow)
          .sort((a, b) => Number(a.differs) - Number(b.differs) || Number(b.dated) - Number(a.dated) || a.dist - b.dist || a.d.id.localeCompare(b.d.id))
        const best = candidates[0]
        if (best) {
          match = { dedupeKey, documentId: best.d.id }
          if (!best.dated) match.note = 'document_date_unknown'
          else if (best.differs) match.note = 'institution_differs'
        }
      }
      if (match) {
        closureProposals.push(match)
        continue
      }

      const src = sourceLabel(t)
      const institution = str(t.fields.referred_to_text) ?? str(t.fields.institution_name)
      items.push({
        dedupeKey,
        ruleId: rule.id,
        ruleVersion: rule.version,
        triggerEventId: t.id,
        triggerKind: t.kind,
        expectedTypes,
        window,
        wording: lang((l) =>
          fill(rule.wording[l], {
            event_date: formatDateIN(t.date, l, t.precision),
            source_label: src[l],
            test: test ?? (l === 'en' ? 'Test' : 'जाँच'),
            scan: str(t.fields.scan_name) ?? (l === 'en' ? 'scan' : 'स्कैन'),
            institution: institution ?? (l === 'en' ? 'another hospital' : 'दूसरे अस्पताल'),
          }),
        ),
        neutralWording: neutral(expectedTypes, t),
        sourceLabel: src.en,
        mode,
      })
    }
  }

  // One paper, one item: two triggers in the same document can expect the same paper (an operation note's procedure
  // and its "specimen sent for HPE"; "HPE awaited" and "sent for histopathology" in one discharge summary). Items from
  // one source document that expect the same document types in overlapping windows collapse into one: a rule in
  // production mode wins over a shadow one, then the rule listed first in rules.yaml, then the earlier trigger.
  const rank = new Map((input.rules ?? RADAR_RULES).map((r, i) => [r.id, i]))
  const docOf = new Map(triggers.map((t) => [t.id, t.documentId]))
  const kept: RadarItem[] = []
  for (const it of [...items].sort((a, b) => Number(a.mode === 'shadow') - Number(b.mode === 'shadow') || rank.get(a.ruleId)! - rank.get(b.ruleId)! || (a.window.from ?? '').localeCompare(b.window.from ?? ''))) {
    const doc = it.triggerKind === 'event' && !it.grouped ? docOf.get(it.triggerEventId) : null
    const same = (k: RadarItem) => !k.grouped && k.triggerKind === 'event' && docOf.get(k.triggerEventId) === doc
      && [...k.expectedTypes].sort().join() === [...it.expectedTypes].sort().join()
      && (k.window.from ?? '') <= (it.window.to ?? '\uffff') && (it.window.from ?? '') <= (k.window.to ?? '\uffff')
    if (!doc || !kept.some(same)) kept.push(it)
  }
  items.splice(0, items.length, ...kept)
  items.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || (a.window.from ?? '').localeCompare(b.window.from ?? '') || a.dedupeKey.localeCompare(b.dedupeKey))
  closureProposals.sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey) || a.documentId.localeCompare(b.documentId))
  return { items, closureProposals }
}

// ---------- missing-item state machine (FR-RAD-03) ----------

export type MissingAction =
  | { type: 'request' }
  | { type: 'receive'; documentId: string }
  | { type: 'confirm' }
  | { type: 'reject_match'; backTo: 'expected' | 'requested' }
  | { type: 'unobtainable'; reason: string }
  | { type: 'dismiss'; reason: string }
  | { type: 'reopen' }

export type TransitionResult = { ok: true; state: MissingState } | { ok: false; error: 'invalid_transition' | 'reason_required' }

const TRANSITIONS: Record<MissingState, Partial<Record<MissingAction['type'], MissingState | 'back'>>> = {
  expected: { request: 'requested', receive: 'received', unobtainable: 'unobtainable', dismiss: 'dismissed' },
  requested: { receive: 'received', unobtainable: 'unobtainable', dismiss: 'dismissed' },
  received: { confirm: 'closed', reject_match: 'back', unobtainable: 'unobtainable', dismiss: 'dismissed' },
  closed: {},
  unobtainable: { reopen: 'expected', receive: 'received' },
  dismissed: { reopen: 'expected' },
}

/** expected → requested → received (proposed) → closed (human-confirmed) | unobtainable | dismissed (reason required). */
export function transitionMissing(state: MissingState, action: MissingAction): TransitionResult {
  const next = TRANSITIONS[state][action.type]
  if (!next) return { ok: false, error: 'invalid_transition' }
  if ((action.type === 'dismiss' || action.type === 'unobtainable') && !action.reason?.trim()) return { ok: false, error: 'reason_required' }
  return { ok: true, state: next === 'back' ? (action as { backTo: 'expected' | 'requested' }).backTo : next }
}
