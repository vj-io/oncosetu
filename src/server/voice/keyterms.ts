// Keyterms for one patient's voice answers (FR-VOX-03): the medicines and hospitals already in their record first,
// then the formulary, within Sarvam's limits (50 terms, 64 characters each).
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { DEFAULT_FORMULARY } from '@/core/formulary'
import type { Tx } from '@/db'
import { documents, events } from '@/db/schema'
import { cleanKeyterms } from './sarvam'

/** "Tab. Capecitabine 500 mg BD" → "Capecitabine": the name a person says, without form or dose. */
export function medicineName(raw: string): string | null {
  const m = raw.replace(/^\s*(?:\d{1,2}[.)]\s*)?(?:tab|tablet|cap|capsule|inj|injection|syp|syrup|susp|oint|gel|drops?)\.?\s+/i, '').match(/^[A-Za-z][A-Za-z+-]*(?:\s+(?:acid|sodium|potassium|hydrochloride|HCl)\b)?/i)
  return m ? m[0] : null
}

export function buildKeyterms(i: { medicines: readonly string[]; institutions: readonly string[]; formulary?: readonly string[] }): string[] {
  const meds = i.medicines.map(medicineName).filter((x): x is string => !!x)
  return cleanKeyterms([...meds, ...i.institutions, ...(i.formulary ?? DEFAULT_FORMULARY)])
}

export async function keytermsFor(tx: Tx, patientId: string): Promise<string[]> {
  const [rx, docs] = await Promise.all([
    tx.select({ fields: events.fields }).from(events)
      .where(and(eq(events.patientId, patientId), inArray(events.eventType, ['prescription_documented', 'patient_statement']), isNull(events.withdrawnAt))),
    tx.selectDistinct({ name: documents.institutionName }).from(documents)
      .where(and(eq(documents.patientId, patientId), isNotNull(documents.institutionName))),
  ])
  const medicines: string[] = [], institutions: string[] = []
  for (const r of rx) {
    const f = r.fields as Record<string, unknown>
    if (Array.isArray(f.medication_names)) for (const m of f.medication_names) if (typeof m === 'string') medicines.push(m)
    if (typeof f.institution_name === 'string') institutions.push(f.institution_name)
  }
  for (const d of docs) if (d.name) institutions.push(d.name)
  return buildKeyterms({ medicines, institutions })
}
