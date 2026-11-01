// §16.4 consultation form and study data. Linked to an encounter by id only; no patient fields anywhere.
import { desc, eq, gte, inArray } from 'drizzle-orm'
import type { Tx } from '@/db'
import { encounters, measurementForms } from '@/db/schema'
import { HttpError } from '../http'
import type { AdminCtx } from './ctx'
import { validateMeasurement, type MeasureInput, type MeasureRow, type Phase } from './measurement-core'
import { measurementFormDocTypes } from './tables'

export type MeasureSubmission = MeasureInput & { encounterId: string | null }

export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

export async function submitMeasurement(ctx: AdminCtx, input: MeasureSubmission) {
  const problems = validateMeasurement(input)
  if (problems.length) throw new HttpError(400, 'invalid_form', problems.join(' '))
  if (input.consultationDate > istToday()) throw new HttpError(400, 'invalid_form', 'The consultation date cannot be in the future.')
  if (input.encounterId) {
    const [e] = await ctx.db.select({ id: encounters.id }).from(encounters).where(eq(encounters.id, input.encounterId)) // RLS: own org only
    if (!e) throw new HttpError(404, 'not_found', 'Encounter not found')
  }
  const orgId = ctx.session.orgId
  const [form] = await ctx.db.insert(measurementForms).values({
    orgId, encounterId: input.encounterId, clinicianId: ctx.session.staffId, consultationDate: input.consultationDate, phase: input.phase,
    firstVisit: input.firstVisit, missingRecordPresent: input.missingRecordPresent, missingRecordCount: input.missingRecordCount,
    impact: input.impact, repeatTestOrdered: input.repeatTestOrdered,
    repeatTestReason: input.repeatTestReason as 'unavailable' | 'quality' | 'clinical_need' | null, prepMinutes: input.prepMinutes,
  }).returning({ id: measurementForms.id })
  if (input.missingTypes.length) {
    await ctx.db.insert(measurementFormDocTypes).values([...new Set(input.missingTypes)].map((docType) => ({ orgId, formId: form.id, docType })))
  }
  await ctx.audit('measurement.submit', 'measurement_form', form.id, { phase: input.phase })
  return { id: form.id }
}

async function toRows(tx: Tx, forms: (typeof measurementForms.$inferSelect)[]): Promise<(MeasureRow & { id: string; createdAt: Date })[]> {
  const types = forms.length
    ? await tx.select().from(measurementFormDocTypes).where(inArray(measurementFormDocTypes.formId, forms.map((f) => f.id))) : []
  return forms.map((f) => ({
    id: f.id, createdAt: f.createdAt, phase: f.phase as Phase, consultationDate: f.consultationDate, firstVisit: f.firstVisit,
    missingRecordPresent: f.missingRecordPresent, missingRecordCount: f.missingRecordCount,
    missingTypes: types.filter((t) => t.formId === f.id).map((t) => t.docType), impact: f.impact,
    repeatTestOrdered: f.repeatTestOrdered, repeatTestReason: f.repeatTestReason, prepMinutes: f.prepMinutes, clinicianId: f.clinicianId,
  }))
}

/** All forms of the org (RLS), for the summary and the anonymised export. */
export async function loadMeasureRows(tx: Tx) {
  return toRows(tx, await tx.select().from(measurementForms).orderBy(desc(measurementForms.consultationDate)))
}

export async function myRecentForms(tx: Tx, staffId: string, limit = 15) {
  return toRows(tx, await tx.select().from(measurementForms).where(eq(measurementForms.clinicianId, staffId))
    .orderBy(desc(measurementForms.createdAt)).limit(limit))
}

/** Encounters of the last 14 days, by id/type/time only (no patient data), for linking a form. */
export async function recentEncounters(tx: Tx, limit = 40) {
  return tx.select({ id: encounters.id, type: encounters.type, startedAt: encounters.startedAt }).from(encounters)
    .where(gte(encounters.startedAt, new Date(Date.now() - 14 * 86_400_000))).orderBy(desc(encounters.startedAt)).limit(limit)
}
