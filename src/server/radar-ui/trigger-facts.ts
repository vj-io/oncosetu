// What a missing paper was raised from, when it was not raised by a stored event: a patient's own statement, or a scan
// file with no written report. These rows have no trigger event, so the date and the place come from here. Shared by the
// staff views (describeRows) and the family's home, so both say the same thing about the same item.
import { inArray } from 'drizzle-orm'
import { istDate } from '@/core/copy'
import type { DatePrecision } from '@/core/types'
import type { Tx } from '@/db'
import { documents, patientStatements } from '@/db/schema'

export type TriggerFacts = {
  kind: 'statement' | 'document'
  /** The statement's id, or the scan file's id. */
  id: string
  date: string | null
  precision: DatePrecision
  /** The place the patient named, or the place that wrote the scan. */
  institution: string | null
  /** Study or scan name ("PET-CT"), when one is known. */
  label: string | null
  /** The patient's own words (statements only). */
  quote: string | null
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const first = (v: unknown): string | null => (Array.isArray(v) ? text(v.find((x) => text(x))) : text(v))

/** Facts for rows whose `match_window` says the trigger was a statement or a scan file, keyed by missing_records id. */
export async function loadTriggerFacts(tx: Tx, rows: { id: string; matchWindow: Record<string, unknown> | null }[]): Promise<Map<string, TriggerFacts>> {
  const want = rows.flatMap((r) => {
    const w = r.matchWindow ?? {}
    return (w.triggerKind === 'statement' || w.triggerKind === 'document') && typeof w.triggerId === 'string' ? [{ rowId: r.id, kind: w.triggerKind as 'statement' | 'document', id: w.triggerId }] : []
  })
  const out = new Map<string, TriggerFacts>()
  if (!want.length) return out
  const stIds = [...new Set(want.filter((w) => w.kind === 'statement').map((w) => w.id))]
  const docIds = [...new Set(want.filter((w) => w.kind === 'document').map((w) => w.id))]
  const sts = stIds.length ? await tx.select({ id: patientStatements.id, at: patientStatements.createdAt, answer: patientStatements.answer, transcript: patientStatements.transcript })
    .from(patientStatements).where(inArray(patientStatements.id, stIds)) : []
  const docs = docIds.length ? await tx.select({ id: documents.id, date: documents.documentDate, institution: documents.institutionName, flags: documents.flags })
    .from(documents).where(inArray(documents.id, docIds)) : []
  const stById = new Map(sts.map((s) => [s.id, s]))
  const docById = new Map(docs.map((d) => [d.id, d]))
  for (const w of want) {
    if (w.kind === 'statement') {
      const s = stById.get(w.id)
      if (!s) continue
      const a = (s.answer ?? {}) as { statedDate?: unknown; statedPrecision?: DatePrecision | null; institutionName?: unknown; scanNames?: unknown; medicationNames?: unknown }
      const stated = text(a.statedDate)
      out.set(w.rowId, {
        kind: 'statement', id: s.id, date: stated ?? istDate(s.at.toISOString()), precision: stated ? a.statedPrecision ?? 'day' : 'day',
        institution: text(a.institutionName), label: first(a.scanNames), quote: text(s.transcript),
      })
    } else {
      const d = docById.get(w.id)
      if (!d) continue
      const im = (d.flags as { imaging?: { studyLabel?: unknown; modalityLabel?: unknown; studyDate?: unknown } } | null)?.imaging
      const date = text(im?.studyDate) ?? d.date
      out.set(w.rowId, { kind: 'document', id: d.id, date, precision: date ? 'day' : 'unknown', institution: text(d.institution), label: text(im?.studyLabel) ?? text(im?.modalityLabel), quote: null })
    }
  }
  return out
}
