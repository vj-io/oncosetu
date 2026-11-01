// Pre-visit statements (FR-VOX-01..07): saved rows, the patient_statement events they produce, and the staff view.
// A statement is what the patient said. It is never upgraded to document-supported (FR-VOX-05) and never classified (FR-VOX-07).
import { desc, eq, inArray } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { Lang } from '@/core/types'
import type { Tx } from '@/db'
import { events, evidence, patientStatements } from '@/db/schema'
import { now } from '../clock'
import { sha256Hex } from '../crypto'
import {
  buildReadback, hasContent, monthYear, QUESTION_IDS, splitNames, statedDate, transcriptOf,
  type Answers, type QuestionId,
} from './visit-model'

export type VisitConfirmation = 'confirmed' | 'corrected' | 'unconfirmed'
export type Saver = { orgId: string; patientId: string; actor: { kind: 'patient' | 'caregiver'; id: string }; lang: Lang }

/**
 * Stores one row per answered question (answer verbatim, the read-back text, language, confirmation, ASR provider when
 * voice typing was used) and one `patient_statement` event per "yes" or "anything else" answer, each with the patient's
 * words as its evidence. Relative dates stay in the words; only a month/year the patient picked becomes a date.
 */
export async function saveVisit(tx: Tx, s: Saver, answers: Answers, confirmation: VisitConfirmation): Promise<{ batchId: string; statements: number; events: number }> {
  const at = await now(s.orgId)
  const batchId = uuidv7()
  const confirmed = confirmation !== 'unconfirmed'
  let nEvents = 0
  let nStatements = 0
  for (const q of QUESTION_IDS) {
    const a = answers[q]
    if (!a) continue
    const transcript = transcriptOf(q, a, s.lang)
    const sd = statedDate(a)
    const meds = q === 'new_medicines' ? splitNames(a.names) : []
    const scans = q === 'new_tests' && a.testKind === 'scan' ? (splitNames(a.names).length ? splitNames(a.names) : ['scan']) : []
    const institution = q !== 'anything_else' && a.place ? a.place : null
    const [row] = await tx.insert(patientStatements).values({
      orgId: s.orgId, patientId: s.patientId, questionId: q,
      // answer: everything the patient chose or typed, as given, plus the fields the Radar reads (see core CoreStatement)
      answer: {
        ...a, batchId, medicationNames: meds, scanNames: scans, institutionName: institution,
        statedDate: sd?.iso ?? null, statedPrecision: sd?.precision ?? null,
      },
      transcript, language: s.lang, readbackText: buildReadback({ [q]: a }, s.lang).lines[0]?.text ?? null,
      confirmation: confirmation === 'unconfirmed' ? 'pending' : confirmation, asrProvider: a.voice ? 'browser-webspeech' : null,
      createdByKind: s.actor.kind, createdById: s.actor.id, createdAt: at, confirmedAt: confirmed ? at : null,
    }).returning({ id: patientStatements.id })
    nStatements++

    if (!hasContent(q, a)) continue
    const dateText = [monthYear(a, 'en'), (a.whenText ?? '').trim()].filter(Boolean).join(' · ')
    // The event carries the words, not the Radar trigger fields (medication_names / scan_name): the Radar already reads the
    // confirmed statement ROW (answer.medicationNames / scanNames), so a dated event with those fields would raise a second,
    // duplicate item, and would do so for unconfirmed statements too. The row keeps the structured names; the evidence links to it.
    const fields: Record<string, unknown> = { statement_text: transcript }
    if (institution) fields.institution_name = institution
    if (dateText) fields.event_date_text = dateText
    const [ev] = await tx.insert(events).values({
      orgId: s.orgId, patientId: s.patientId, eventType: 'patient_statement', fields,
      eventDate: sd?.iso ?? null, datePrecision: sd?.precision ?? 'unknown',
      sourceType: s.actor.kind === 'caregiver' ? 'caregiver_reported' : 'patient_reported',
      extractionMethod: a.voice ? 'asr' : 'manual',
      flags: confirmed ? { patient_confirmed: true } : {},
      receivedAt: at, createdByKind: s.actor.kind, createdById: s.actor.id,
    }).returning({ id: events.id })
    await tx.insert(evidence).values({
      orgId: s.orgId, patientId: s.patientId, eventId: ev.id, statementId: row.id, quote: transcript, quoteSha256: sha256Hex(transcript),
    })
    nEvents++
  }
  return { batchId, statements: nStatements, events: nEvents }
}

export type StatementGroup = {
  key: string; encounterId: string | null; at: string; by: 'patient' | 'caregiver' | 'staff' | 'system'
  items: {
    id: string; questionId: QuestionId | string; transcript: string | null; readback: string | null
    confirmation: 'pending' | 'confirmed' | 'corrected' | 'declined'; voice: boolean; language: string | null
    eventId: string | null; conflict: boolean
  }[]
}

/** Statements for the staff tab, newest first, grouped per encounter (or per submission when none is linked yet). */
export async function loadStatementGroups(tx: Tx, patientId: string): Promise<StatementGroup[]> {
  const rows = await tx.select().from(patientStatements).where(eq(patientStatements.patientId, patientId))
    .orderBy(desc(patientStatements.createdAt)).limit(200)
  if (!rows.length) return []
  const ev = await tx.select({ statementId: evidence.statementId, eventId: events.id, flags: events.flags, conflictGroup: events.conflictGroup })
    .from(evidence).innerJoin(events, eq(events.id, evidence.eventId))
    .where(inArray(evidence.statementId, rows.map((r) => r.id)))
  const byStatement = new Map(ev.map((e) => [e.statementId!, e]))
  const groups = new Map<string, StatementGroup>()
  for (const r of rows) {
    const batch = typeof r.answer?.batchId === 'string' ? r.answer.batchId : r.id
    const key = r.encounterId ?? batch
    const e = byStatement.get(r.id)
    const g = groups.get(key) ?? { key, encounterId: r.encounterId, at: r.createdAt.toISOString(), by: r.createdByKind, items: [] }
    g.items.push({
      id: r.id, questionId: r.questionId, transcript: r.transcript, readback: r.readbackText, confirmation: r.confirmation,
      voice: !!r.asrProvider, language: r.language, eventId: e?.eventId ?? null, conflict: !!e && (!!e.flags?.conflict || !!e.conflictGroup),
    })
    groups.set(key, g)
  }
  const order = new Map(QUESTION_IDS.map((q, i) => [q as string, i]))
  for (const g of groups.values()) g.items.sort((a, b) => (order.get(a.questionId) ?? 9) - (order.get(b.questionId) ?? 9))
  return [...groups.values()]
}
