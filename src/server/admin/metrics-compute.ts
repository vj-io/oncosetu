// Pure metric computations over plain rows (PRD §16). No DB, no clock, no invented numbers:
// every ratio carries its numerator and denominator, and an empty denominator is "no data", not 0%.

export type Ratio = { num: number; den: number }
export const ratio = (num: number, den: number): Ratio => ({ num, den })

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ── provenance coverage + unsupported facts (FR-GATE, §16.1/§16.2) ───────────
export type EventRow = { eventType: string; verificationStatus: string; withdrawn: boolean; evidenceCount: number }

/** An event is "live" (could be displayed as a fact) unless withdrawn or rejected. */
const live = (e: EventRow) => !e.withdrawn && e.verificationStatus !== 'rejected'
/** Supported = at least one evidence row (document quote or statement), or it is itself a patient statement. */
const supported = (e: EventRow) => e.evidenceCount > 0 || e.eventType === 'patient_statement'

export function provenance(rows: readonly EventRow[]) {
  const ev = rows.filter(live)
  const covered = ev.filter(supported).length
  const unsupportedByType: Record<string, number> = {}
  for (const e of ev) if (!supported(e)) unsupportedByType[e.eventType] = (unsupportedByType[e.eventType] ?? 0) + 1
  return { coverage: ratio(covered, ev.length), unsupported: ev.length - covered, unsupportedByType }
}

// ── correction rate by document type ─────────────────────────────────────────
export type VerifiedEventRow = { docType: string | null; status: string }
const VERIFIED = new Set(['verified_matches_source', 'edited', 'rejected'])

/** corrected = edited or rejected; denominator = every item a person has verified, edited or rejected. */
export function correctionRates(rows: readonly VerifiedEventRow[]) {
  const by = new Map<string, Ratio>()
  for (const r of rows) {
    if (!VERIFIED.has(r.status)) continue
    const k = r.docType ?? 'no_document'
    const cur = by.get(k) ?? ratio(0, 0)
    by.set(k, ratio(cur.num + (r.status === 'verified_matches_source' ? 0 : 1), cur.den + 1))
  }
  const byType = [...by].map(([docType, r]) => ({ docType, ...r })).sort((a, b) => b.den - a.den || a.docType.localeCompare(b.docType))
  const total = byType.reduce((t, r) => ratio(t.num + r.num, t.den + r.den), ratio(0, 0))
  return { byType, total }
}

// ── Radar funnel + closure before next sealed snapshot (FR-RAD-06, §16.1) ───
export type MissingRow = {
  patientId: string; mode: 'production' | 'shadow'; state: string; createdAt: Date; stateChangedAt: Date; hasRequest: boolean
}

export function radarMetrics(items: readonly MissingRow[], snapshots: ReadonlyMap<string, readonly Date[]>) {
  const prod = items.filter((i) => i.mode === 'production')
  const received = (i: MissingRow) => i.state === 'received' || i.state === 'closed'
  let eligible = 0, closedBefore = 0
  for (const i of prod) {
    // "next consultation" = first sealed snapshot at or after the item was detected.
    const next = (snapshots.get(i.patientId) ?? []).filter((s) => s >= i.createdAt).sort((a, b) => +a - +b)[0]
    if (!next) continue
    eligible++
    if (received(i) && i.stateChangedAt <= next) closedBefore++
  }
  return {
    detected: prod.length,
    shadow: items.length - prod.length,
    requested: prod.filter((i) => i.hasRequest || i.state === 'requested').length,
    received: prod.filter(received).length,
    closed: prod.filter((i) => i.state === 'closed').length,
    awaitingSnapshot: prod.length - eligible,
    closure: ratio(closedBefore, eligible),
  }
}

// ── request fulfilment (FR-REQ-06) ───────────────────────────────────────────
export type RequestRow = { institutionType: string | null; sentAt: Date | null; fulfilledAt: Date | null }
const DAY = 86_400_000

function fulfilment(rows: readonly RequestRow[]) {
  const sent = rows.filter((r) => r.sentAt)
  const done = sent.filter((r) => r.fulfilledAt)
  return {
    sent: sent.length,
    fulfilled: done.length,
    rate: ratio(done.length, sent.length),
    medianDays: median(done.map((r) => (+r.fulfilledAt! - +r.sentAt!) / DAY)),
  }
}

export function requestFulfilment(rows: readonly RequestRow[]) {
  const types = [...new Set(rows.map((r) => r.institutionType ?? 'unknown'))].sort()
  return {
    overall: fulfilment(rows),
    byType: types.map((t) => ({ institutionType: t, ...fulfilment(rows.filter((r) => (r.institutionType ?? 'unknown') === t)) })),
  }
}

// ── pre-visit completion ─────────────────────────────────────────────────────
export type EncounterRow = { id: string; patientId: string; type: string; startedAt: Date }
export type StatementRow = { patientId: string; encounterId: string | null; confirmation: string; createdAt: Date }
export const PREVISIT_WINDOW_DAYS = 7

/**
 * Returning encounters with ≥ 1 confirmed/corrected patient statement: linked to the encounter, or captured by
 * the same patient in the PREVISIT_WINDOW_DAYS before it started (pre-visit links are answered before the desk
 * opens the encounter).
 */
export function previsitCompletion(encounters: readonly EncounterRow[], statements: readonly StatementRow[]): Ratio {
  const done = statements.filter((s) => s.confirmation === 'confirmed' || s.confirmation === 'corrected')
  const returning = encounters.filter((e) => e.type === 'returning')
  const ok = returning.filter((e) => done.some((s) => s.encounterId === e.id
    || (s.encounterId == null && s.patientId === e.patientId
      && +s.createdAt <= +e.startedAt && +s.createdAt >= +e.startedAt - PREVISIT_WINDOW_DAYS * DAY)))
  return ratio(ok.length, returning.length)
}

// ── clinician review time (§16.1) ────────────────────────────────────────────
export type ReviewAuditRow = { at: Date; action: string; actorRole: string; targetId: string | null; details: Record<string, unknown> }
export const REVIEW_ACTIONS = ['encounter.started', 'ledger.view', 'snapshot.seal'] as const

/**
 * Minutes from a clinician's first ledger view during a visit to that visit's seal, per visit, from audit rows only
 * (all on the real clock; encounter and snapshot timestamps may run on the demo clock). A visit counts once it has both
 * a clinician ledger view and a seal. Median per visit type; §16.1 targets the returning visit.
 */
// ponytail: O(visits × rows) scan; group by patient first past ~10k visits.
export function clinicianReviewTime(rows: readonly ReviewAuditRow[]) {
  const byAt = (a: ReviewAuditRow, b: ReviewAuditRow) => +a.at - +b.at
  const views = rows.filter((r) => r.action === 'ledger.view' && r.actorRole === 'clinician')
  const seals = rows.filter((r) => r.action === 'snapshot.seal').sort(byAt)
  const minutes: Record<string, number[]> = {}
  for (const e of rows) {
    if (e.action !== 'encounter.started') continue
    const seal = seals.find((s) => s.details.encounterId === e.targetId)
    const view = seal && views.filter((v) => v.targetId === e.details.patientId && v.at >= e.at && v.at <= seal.at).sort(byAt)[0]
    if (!seal || !view) continue
    const type = String(e.details.type)
    minutes[type] = [...(minutes[type] ?? []), (+seal.at - +view.at) / 60_000]
  }
  const stat = (xs: number[] = []) => ({ medianMinutes: median(xs), visits: xs.length })
  return { returning: stat(minutes.returning), firstVisit: stat(minutes.onboarding) }
}

// ── non-disclosure prevalence ────────────────────────────────────────────────
export function disclosurePrevalence(statuses: readonly string[]) {
  const n = (s: string) => statuses.filter((x) => x === s).length
  return {
    total: statuses.length, cleared: n('cleared'), notCleared: n('not_cleared'), unknown: n('unknown'),
    nonCleared: ratio(statuses.length - n('cleared'), statuses.length),
  }
}

// ── document census (K3) ─────────────────────────────────────────────────────
export type PageRow = { hasText: boolean; handwritten: boolean | null; lowConfidence: boolean }

/** printed/handwritten/imageOnly are mutually exclusive and sum to total; lowConfidence overlaps them. */
export function documentCensus(pages: readonly PageRow[]) {
  const imageOnly = pages.filter((p) => !p.hasText).length
  const handwritten = pages.filter((p) => p.hasText && p.handwritten).length
  return {
    total: pages.length, imageOnly, handwritten, printed: pages.length - imageOnly - handwritten,
    lowConfidence: pages.filter((p) => p.lowConfidence).length,
  }
}

// ── safety KPIs (§16.2) ──────────────────────────────────────────────────────
export type SafetyStatus = 'on_target' | 'breach' | 'not_measured'
export type SafetyKpi = {
  key: string; label: string; target: string; observed: string; status: SafetyStatus; basis: string; zeroTarget: boolean
}

export type SafetyInput = {
  wrongPatientAutoAttached: number
  unsupportedFacts: number
  qa: { reviewed: number; disagree: number }
  radarWordingHits: number; radarTemplates: number
  diagnosisWordHits: number; diagnosisSurfaceScanned: number
  /** Message kinds that matched, shown so a breach can be traced (no message text). */
  diagnosisHitKinds?: string[]
}

/**
 * The disclosure status a patient had at a given moment, rebuilt from the audit trail of changes (each row says from -> to).
 * A message sent while disclosure was "cleared" may correctly name the diagnosis; judging it by the status the patient has
 * today (after a clinician changed it) would raise a false breach, so each message is judged by the status in force when it was sent.
 */
export function disclosureAt(current: string, changes: readonly { at: Date; from: string; to: string }[], at: Date): string {
  const sorted = [...changes].sort((a, b) => a.at.getTime() - b.at.getTime())
  const next = sorted.find((c) => c.at.getTime() > at.getTime())
  return next ? next.from : current
}

const zero = (n: number): SafetyStatus => (n === 0 ? 'on_target' : 'breach')

export function safetyKpis(i: SafetyInput): SafetyKpi[] {
  const qaRate = i.qa.reviewed ? i.qa.disagree / i.qa.reviewed : null
  return [
    {
      key: 'wrong_patient', zeroTarget: true, target: '0', observed: String(i.wrongPatientAutoAttached), status: zero(i.wrongPatientAutoAttached),
      label: 'Wrong-patient documents attached and not caught before seal',
      basis: 'Proxy: documents with an identity mismatch or insufficient result that were attached with no human decision. Ground truth needs source review.',
    },
    {
      key: 'unsupported', zeroTarget: true, target: '0', observed: String(i.unsupportedFacts), status: zero(i.unsupportedFacts),
      label: 'Unsupported facts (failed gate) displayed as facts',
      basis: 'Live events with no evidence row that are not patient statements.',
    },
    {
      key: 'qa_mismatch', zeroTarget: false, target: '< 1%',
      observed: qaRate == null ? 'Not yet measured' : `${(qaRate * 100).toFixed(1).replace(/\.0$/, '')}% (${i.qa.disagree} of ${i.qa.reviewed})`,
      status: qaRate == null ? 'not_measured' : qaRate < 0.01 ? 'on_target' : 'breach',
      label: 'Verified items later found not to match source (sampling QA)',
      basis: 'Second-review disagreement rate on the 5% sample of records-verified items.',
    },
    {
      key: 'omissions', zeroTarget: false, target: 'recall ≥ 0.85 per class', observed: 'Not collected in-app', status: 'not_measured',
      label: 'Omissions found in the 10% clinician-abstraction sample',
      basis: 'Manual adjudication by the clinician advisor (PRD §16.3); recorded outside this system.',
    },
    {
      key: 'clinical_wording', zeroTarget: true, target: '0', observed: String(i.radarWordingHits), status: zero(i.radarWordingHits),
      label: 'Clinical wording generated by the system (copy audit)',
      basis: `Radar wording templates (EN and HI, ${i.radarTemplates} checked) linted against the administrative-wording banned list.`,
    },
    {
      key: 'diagnosis_words', zeroTarget: true, target: '0', observed: String(i.diagnosisWordHits), status: zero(i.diagnosisWordHits),
      label: 'Diagnosis words reaching a not_cleared / unknown patient-facing surface',
      basis: `${i.diagnosisSurfaceScanned} messages and read-back texts sent while the patient's disclosure was not cleared (judged by the status at send time), linted against the diagnosis wordlist.${i.diagnosisHitKinds?.length ? ` Matched: ${i.diagnosisHitKinds.join(', ')}.` : ''}`,
    },
    {
      key: 'privacy', zeroTarget: true, target: '0', observed: 'Not collected in-app', status: 'not_measured',
      label: 'Privacy incidents',
      basis: 'Declared through the breach runbook (PRD §10.4); there is no in-app register.',
    },
  ]
}
