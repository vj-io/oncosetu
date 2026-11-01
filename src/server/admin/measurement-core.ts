// §16.4 baseline measurement study: form validation, summary and the anonymised CSV. Pure.
// Privacy by construction: the CSV is built only from the whitelisted MeasureRow fields (no encounter id, no
// clinician id, no exact date), so nothing identifying can reach it even if a caller passes a fuller row.
import { DOC_TYPES } from '@/core/types'
import { median } from './metrics-compute'
import { toCsv } from './csv'

export const PHASES = ['baseline', 'shadow', 'live'] as const
export const IMPACTS = ['none', 'delayed_decision', 'repeat_test_ordered', 'visit_rescheduled'] as const
export const REPEAT_REASONS = ['unavailable', 'quality', 'clinical_need'] as const
export type Phase = (typeof PHASES)[number]
export type Impact = (typeof IMPACTS)[number]

export type MeasureRow = {
  phase: Phase; consultationDate: string // YYYY-MM-DD
  firstVisit: boolean; missingRecordPresent: boolean; missingRecordCount: number; missingTypes: string[]
  impact: Impact; repeatTestOrdered: boolean; repeatTestReason: string | null; prepMinutes: number | null
  clinicianId: string
}

export type MeasureInput = Omit<MeasureRow, 'clinicianId' | 'consultationDate'> & { consultationDate: string }

/** Cross-field rules of the 60-second form. Returns human-readable problems (empty = valid). */
export function validateMeasurement(f: MeasureInput): string[] {
  const errs: string[] = []
  if (!f.missingRecordPresent && (f.missingRecordCount > 0 || f.missingTypes.length > 0)) errs.push('Missing-record count and types must be empty when no record was missing.')
  if (f.missingRecordPresent && f.missingRecordCount < 1) errs.push('Give the number of missing documents (at least 1).')
  if (f.missingTypes.some((t) => !(DOC_TYPES as readonly string[]).includes(t))) errs.push('Unknown document type.')
  if (f.repeatTestOrdered && !f.repeatTestReason) errs.push('Give the reason for the repeat test.')
  if (!f.repeatTestOrdered && f.repeatTestReason) errs.push('A repeat-test reason needs "repeat test ordered".')
  if (f.impact === 'repeat_test_ordered' && !f.repeatTestOrdered) errs.push('Impact "repeat test ordered" needs the repeat-test box ticked.')
  return errs
}

const rate = (num: number, den: number) => ({ num, den })

export function summariseMeasurement(rows: readonly MeasureRow[]) {
  const phases = PHASES.map((phase) => {
    const r = rows.filter((x) => x.phase === phase)
    const first = r.filter((x) => x.firstVisit)
    return {
      phase, n: r.length,
      missingRate: rate(first.filter((x) => x.missingRecordPresent).length, first.length), // first visits only (§16.4)
      repeatRate: rate(r.filter((x) => x.repeatTestOrdered).length, r.length),
      impact: Object.fromEntries(IMPACTS.map((i) => [i, r.filter((x) => x.impact === i).length])) as Record<Impact, number>,
      prepMedian: median(r.flatMap((x) => (x.prepMinutes == null ? [] : [x.prepMinutes]))),
      prepN: r.filter((x) => x.prepMinutes != null).length,
    }
  })
  const missing = rows.filter((x) => x.missingRecordPresent)
  const typeCounts = [...new Set(missing.flatMap((x) => x.missingTypes))]
    .map((t) => ({ docType: t, n: missing.filter((x) => x.missingTypes.includes(t)).length })).sort((a, b) => b.n - a.n || a.docType.localeCompare(b.docType))
  const reasons = REPEAT_REASONS.map((reason) => ({ reason, n: rows.filter((x) => x.repeatTestReason === reason).length }))
  return { total: rows.length, phases, typeCounts, reasons }
}

/** Monday of the ISO week containing a YYYY-MM-DD date. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export const MEASURE_CSV_HEADER = [
  'row', 'phase', 'consultation_week_start', 'first_visit', 'missing_record_present', 'missing_record_count',
  'missing_document_types', 'impact', 'repeat_test_ordered', 'repeat_test_reason', 'prep_minutes', 'clinician_code',
] as const

/** Anonymised export: rows are numbered after sorting, clinicians become C1…Cn, dates become the week start. */
export function measurementCsv(rows: readonly MeasureRow[]): string {
  const codes = new Map([...new Set(rows.map((r) => r.clinicianId))].sort().map((id, i) => [id, `C${i + 1}`]))
  const sorted = [...rows].sort((a, b) => a.consultationDate.localeCompare(b.consultationDate) || a.phase.localeCompare(b.phase))
  return toCsv(MEASURE_CSV_HEADER, sorted.map((r, i) => [
    i + 1, r.phase, weekStart(r.consultationDate), r.firstVisit, r.missingRecordPresent, r.missingRecordCount,
    [...r.missingTypes].sort().join(';'), r.impact, r.repeatTestOrdered, r.repeatTestReason ?? '', r.prepMinutes ?? '',
    codes.get(r.clinicianId),
  ]))
}
