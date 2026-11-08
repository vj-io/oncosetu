// Pre-visit statements (FR-VOX-01..07): saved rows, the patient_statement events they produce, and the staff view.
// A statement is what the patient said. It is never upgraded to document-supported (FR-VOX-05) and never classified (FR-VOX-07).
import { desc, eq, inArray } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { Lang } from '@/core/types'
import type { Tx } from '@/db'
import { events, evidence, patientStatements } from '@/db/schema'
import { now } from '../clock'
import { decryptField, encryptField, sha256Hex } from '../crypto'
import { linkClips } from '../voice/clips'
import { BROWSER_ASR, asr } from '../voice/provider'
import {
  buildReadback, hasContent, monthYear, QUESTION_IDS, splitNames, statedDate, transcriptOf,
  type Answers, type QuestionId,
} from './visit-model'

export type VisitConfirmation = 'confirmed' | 'corrected' | 'unconfirmed'

/**
 * Voice shadow mode (FR-VOX-03): what Sarvam heard is sealed by the transcribe route into a token the browser holds but
 * cannot read, so it can never fill the answer. The statement keeps the sealed tokens; only staff screens open them.
 */
export const sealShadow = (v: { clipId: string; patientId: string; text: string }) => encryptField(JSON.stringify(v))
export function openShadow(token: string): { clipId: string; patientId: string; text: string } | null {
  try {
    const v = JSON.parse(decryptField(token)) as Record<string, unknown>
    return typeof v.clipId === 'string' && typeof v.patientId === 'string' && typeof v.text === 'string' ? { clipId: v.clipId, patientId: v.patientId, text: v.text } : null
  } catch {
    return null // not sealed by this server: dropped
  }
}
export type Saver = { orgId: string; patientId: string; actor: { kind: 'patient' | 'caregiver'; id: string }; lang: Lang }

/**
 * Stores one row per answered question (answer verbatim, the read-back text, language, confirmation, ASR provider when
 * voice typing was used) and one `patient_statement` event per "yes" or "anything else" answer, each with the patient's
 * words as its evidence. Relative dates stay in the words; only a month/year the patient picked becomes a date.
 */
export async function saveVisit(tx: Tx, s: Saver, answers: Answers, confirmation: VisitConfirmation): Promise<{ batchId: string; statements: number; events: number; shadowClips: number }> {
  const at = await now(s.orgId)
  const batchId = uuidv7()
  const confirmed = confirmation !== 'unconfirmed'
  let nEvents = 0
  let nStatements = 0
  let nShadow = 0
  for (const q of QUESTION_IDS) {
    const a = answers[q]
    if (!a) continue
    const transcript = transcriptOf(q, a, s.lang)
    const sd = statedDate(a)
    const meds = q === 'new_medicines' ? splitNames(a.names) : []
    const scans = q === 'new_tests' && a.testKind === 'scan' ? (splitNames(a.names).length ? splitNames(a.names) : ['scan']) : []
    const institution = q !== 'anything_else' && a.place ? a.place : null
    const clips = a.clips ?? []
    const shadow = (a.shadow ?? []).filter((t) => openShadow(t)?.patientId === s.patientId) // this patient's own recordings only
    const [row] = await tx.insert(patientStatements).values({
      orgId: s.orgId, patientId: s.patientId, questionId: q,
      // answer: everything the patient chose or typed, as given, plus the fields the Radar reads (see core CoreStatement)
      answer: {
        ...a, clips: undefined, shadow: undefined, batchId, medicationNames: meds, scanNames: scans, institutionName: institution,
        statedDate: sd?.iso ?? null, statedPrecision: sd?.precision ?? null, ...(shadow.length ? { asrShadow: shadow } : {}),
      },
      transcript, language: s.lang, readbackText: buildReadback({ [q]: a }, s.lang).lines[0]?.text ?? null,
      confirmation: confirmation === 'unconfirmed' ? 'pending' : confirmation, asrProvider: clips.length ? asr.name : a.voice ? BROWSER_ASR : null,
      asrModel: clips.length ? asr.model : null, audioId: clips[0] ?? null,
      createdByKind: s.actor.kind, createdById: s.actor.id, createdAt: at, confirmedAt: confirmed ? at : null,
    }).returning({ id: patientStatements.id })
    await linkClips(tx, s.patientId, clips, row.id)
    nShadow += (await linkClips(tx, s.patientId, shadow.map((t) => openShadow(t)!.clipId), row.id)).length
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
  return { batchId, statements: nStatements, events: nEvents, shadowClips: nShadow }
}

export type StatementGroup = {
  key: string; encounterId: string | null; at: string; by: 'patient' | 'caregiver' | 'staff' | 'system'
  items: {
    id: string; questionId: QuestionId | string; transcript: string | null; readback: string | null
    confirmation: 'pending' | 'confirmed' | 'corrected' | 'declined'; voice: boolean; language: string | null
    /** The kept recording (FR-VOX-05) and what transcribed it, when the answer was spoken through Sarvam. */
    audioId: string | null; asr: string | null
    /** Voice shadow mode: recordings made beside a typed answer and what Sarvam heard (never part of the answer). */
    shadow: { clipId: string; text: string }[]
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
      voice: !!r.asrProvider, language: r.language, audioId: r.audioId, asr: r.asrProvider ? [r.asrProvider, r.asrModel].filter(Boolean).join(' · ') : null, eventId: e?.eventId ?? null, conflict: !!e && (!!e.flags?.conflict || !!e.conflictGroup),
      shadow: (Array.isArray(r.answer?.asrShadow) ? r.answer.asrShadow : []).flatMap((t) => {
        const v = typeof t === 'string' ? openShadow(t) : null
        return v && v.patientId === patientId ? [{ clipId: v.clipId, text: v.text }] : []
      }),
    })
    groups.set(key, g)
  }
  const order = new Map(QUESTION_IDS.map((q, i) => [q as string, i]))
  for (const g of groups.values()) g.items.sort((a, b) => (order.get(a.questionId) ?? 9) - (order.get(b.questionId) ?? 9))
  return [...groups.values()]
}
