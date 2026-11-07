// FR-ADM-03: §16 KPIs, computed from the real tables on every request. Aggregates only: no patient fields leave here.
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import {
  auditLog, documentPages, documents, encounters, events, evidence, missingRecords, outbox, patientStatements, patients, recordRequests, snapshots,
} from '@/db/schema'
import { lintText } from '@/core/copy'
import { RADAR_RULES } from '@/core/radar/rules'
import { EXTRACTABLE_EVENT_TYPES } from '@/core/types'
import {
  clinicianReviewTime, correctionRates, disclosureAt, disclosurePrevalence, documentCensus, previsitCompletion, provenance, radarMetrics, requestFulfilment, safetyKpis,
  REVIEW_ACTIONS, type MissingRow,
} from './metrics-compute'
import { loadQa } from './qa'

export async function loadMetrics(tx: Tx) {
  const evRows = await tx.select({
    eventType: events.eventType, verificationStatus: events.verificationStatus, withdrawn: sql<boolean>`${events.withdrawnAt} is not null`,
    evidenceCount: sql<number>`(select count(*)::int from ${evidence} where ${evidence.eventId} = ${events.id})`,
    docType: documents.docType, extractionMethod: events.extractionMethod,
  }).from(events).leftJoin(documents, eq(documents.id, events.documentId))

  const prov = provenance(evRows)
  const corrections = correctionRates(evRows
    .filter((e) => e.extractionMethod !== 'manual' && (EXTRACTABLE_EVENT_TYPES as readonly string[]).includes(e.eventType))
    .map((e) => ({ docType: e.docType, status: e.verificationStatus })))

  const items = await tx.select({
    id: missingRecords.id, patientId: missingRecords.patientId, mode: missingRecords.mode, state: missingRecords.state,
    createdAt: missingRecords.createdAt, stateChangedAt: missingRecords.stateChangedAt,
  }).from(missingRecords)
  const requested = new Set((await tx.select({ id: recordRequests.missingRecordId }).from(recordRequests).where(isNotNull(recordRequests.missingRecordId))).map((r) => r.id))
  const snaps = new Map<string, Date[]>()
  for (const s of await tx.select({ patientId: snapshots.patientId, sealedAt: snapshots.sealedAt }).from(snapshots)) {
    snaps.set(s.patientId, [...(snaps.get(s.patientId) ?? []), s.sealedAt])
  }
  const radar = radarMetrics(items.map((i): MissingRow => ({ ...i, hasRequest: requested.has(i.id) })), snaps)

  const fulfilment = requestFulfilment((await tx.select({ sentAt: recordRequests.sentAt, fulfilledAt: recordRequests.fulfilledAt }).from(recordRequests))
    .map((r) => ({ ...r, institutionType: null }))) // record_requests.institution is free text: no institution type is captured

  const previsit = previsitCompletion(
    await tx.select({ id: encounters.id, patientId: encounters.patientId, type: encounters.type, startedAt: encounters.startedAt }).from(encounters),
    await tx.select({ patientId: patientStatements.patientId, encounterId: patientStatements.encounterId, confirmation: patientStatements.confirmation, createdAt: patientStatements.createdAt }).from(patientStatements),
  )

  const review = clinicianReviewTime(await tx.select({
    at: auditLog.at, action: auditLog.action, actorRole: auditLog.actorRole, targetId: auditLog.targetId, details: auditLog.details,
  }).from(auditLog).where(inArray(auditLog.action, [...REVIEW_ACTIONS])))

  const ps = await tx.select({ d: patients.disclosureStatus }).from(patients).where(eq(patients.status, 'active'))
  const disclosure = disclosurePrevalence(ps.map((p) => p.d))

  const census = documentCensus(await tx.select({
    hasText: sql<boolean>`length(btrim(${documentPages.text})) > 0`, handwritten: documents.handwritten, lowConfidence: documentPages.lowConfidence,
  }).from(documentPages).innerJoin(documents, eq(documents.id, documentPages.documentId)).where(sql`${documents.duplicateOf} is null`)) // ponytail: one tiny row per page; group in SQL past ~100k pages

  const [{ n: wrongPatient }] = await tx.select({ n: sql<number>`count(*)::int` }).from(documents)
    .where(and(inArray(documents.identityResult, ['mismatch', 'insufficient']), eq(documents.attachState, 'auto')))

  // Patient-facing text sent while the patient's disclosure was not cleared (FR-CON-07), judged by the status at send time.
  const discRows = await tx.select({ id: patients.id, d: patients.disclosureStatus }).from(patients)
  const currentDisc = new Map(discRows.map((r) => [r.id, r.d as string]))
  const changeRows = await tx.select({ at: auditLog.at, patientId: auditLog.targetId, details: auditLog.details }).from(auditLog).where(eq(auditLog.action, 'patient.disclosure_changed'))
  const changesBy = new Map<string, { at: Date; from: string; to: string }[]>()
  for (const c of changeRows) {
    const d = c.details as { from?: string; to?: string }
    if (c.patientId && d.from && d.to) changesBy.set(c.patientId, [...(changesBy.get(c.patientId) ?? []), { at: c.at, from: d.from, to: d.to }])
  }
  const wasNotCleared = (patientId: string | null, at: Date) =>
    !!patientId && currentDisc.has(patientId) && disclosureAt(currentDisc.get(patientId)!, changesBy.get(patientId) ?? [], at) !== 'cleared'
  const outRows = await tx.select({ t: outbox.body, k: outbox.templateKey, p: outbox.patientId, at: outbox.createdAt }).from(outbox)
  const readRows = await tx.select({ t: patientStatements.readbackText, p: patientStatements.patientId, at: patientStatements.createdAt }).from(patientStatements).where(isNotNull(patientStatements.readbackText))
  const surfaces: { t: string; k: string }[] = [
    ...outRows.filter((r) => wasNotCleared(r.p, r.at)).map((r) => ({ t: r.t, k: r.k })),
    ...readRows.filter((r) => wasNotCleared(r.p, r.at)).map((r) => ({ t: r.t ?? '', k: 'read-back' })),
  ].filter((r) => r.t)
  const hits = surfaces.filter((x) => lintText(x.t, ['diagnosis']).length > 0)

  const qa = await loadQa(tx)
  const safety = safetyKpis({
    wrongPatientAutoAttached: wrongPatient, unsupportedFacts: prov.unsupported, qa,
    radarWordingHits: RADAR_RULES.reduce((n, r) => n + lintText(r.wording.en, ['radar']).length + lintText(r.wording.hi, ['radar']).length, 0),
    radarTemplates: RADAR_RULES.length * 2,
    diagnosisWordHits: hits.length, diagnosisSurfaceScanned: surfaces.length, diagnosisHitKinds: [...new Set(hits.map((h) => h.k))],
  })
  return { prov, corrections, radar, fulfilment, previsit, review, disclosure, census, safety, qa, eventsTotal: evRows.length }
}

export type Metrics = Awaited<ReturnType<typeof loadMetrics>>
