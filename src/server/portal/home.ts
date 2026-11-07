// Data behind the patient home page. Reads only; the wording is built by summary.ts.
import { and, count, desc, eq, gt, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { istDate } from '@/core/copy'
import type { DatePrecision, DocType } from '@/core/types'
import { DOC_TYPES } from '@/core/types'
import type { Tx } from '@/db'
import { documents, events, inboundAliases, missingRecords, patientStatements, recordRequests, shareLinks } from '@/db/schema'
import { now } from '../clock'
import { dropAddress, inboundDomain } from '../inbound/staff'
import type { HomeData } from './summary'

const asDocType = (t: string | null): DocType | null => ((DOC_TYPES as readonly string[]).includes(t ?? '') ? (t as DocType) : null)

export const OPEN_REQUEST_STATES = ['drafted', 'sent', 'reminder_due', 'open_21d'] as const

export async function loadHomeData(tx: Tx, orgId: string, patientId: string): Promise<HomeData> {
  const at = await now(orgId)
  const [docs, looking, [open], [last], [shares]] = await Promise.all([
    tx.select({ id: documents.id, docType: documents.docType, documentDate: documents.documentDate, receivedAt: documents.receivedAt, flags: documents.flags })
      .from(documents)
      .where(and(
        eq(documents.patientId, patientId), isNull(documents.duplicateOf),
        // only papers filed under this patient: a held (possibly another person's), rejected, detached or blocked file is never listed
        notInArray(documents.attachState, ['rejected', 'detached', 'pending_decision']), notInArray(documents.status, ['quarantined']),
      ))
      .orderBy(desc(documents.receivedAt)).limit(50),
    tx.select({
      id: missingRecords.id, expectedTypes: missingRecords.expectedTypes, state: missingRecords.state, window: missingRecords.matchWindow,
      eventDate: events.eventDate, eventDocDate: events.documentDate, precision: events.datePrecision,
      eventFields: events.fields, triggerInstitution: documents.institutionName,
    }).from(missingRecords).leftJoin(events, eq(events.id, missingRecords.triggerEventId)).leftJoin(documents, eq(documents.id, events.documentId))
      .where(and(
        eq(missingRecords.patientId, patientId), eq(missingRecords.mode, 'production'),
        inArray(missingRecords.state, ['expected', 'requested', 'received']),
      )).orderBy(missingRecords.createdAt),
    tx.select({ n: count() }).from(recordRequests)
      .where(and(eq(recordRequests.patientId, patientId), inArray(recordRequests.state, [...OPEN_REQUEST_STATES]))),
    tx.select({ at: patientStatements.createdAt, confirmation: patientStatements.confirmation }).from(patientStatements)
      .where(eq(patientStatements.patientId, patientId)).orderBy(desc(patientStatements.createdAt)).limit(1),
    tx.select({ n: count() }).from(shareLinks)
      .where(and(eq(shareLinks.patientId, patientId), isNull(shareLinks.revokedAt), gt(shareLinks.expiresAt, at))),
  ])
  const attachedDoc = and(
    eq(documents.patientId, patientId), isNull(documents.duplicateOf),
    notInArray(documents.attachState, ['rejected', 'detached', 'pending_decision']), notInArray(documents.status, ['quarantined']),
  )
  // Dates already written in the papers (follow-ups) and the doctor the latest papers name: what the documents say, nothing more.
  const [followUps, [doctorDoc]] = await Promise.all([
    tx.select({
      id: events.id, fields: events.fields, eventDate: events.eventDate, precision: events.datePrecision, status: events.verificationStatus,
      supersedesId: events.supersedesId, docType: documents.docType,
    }).from(events).innerJoin(documents, eq(documents.id, events.documentId))
      .where(and(eq(events.patientId, patientId), eq(events.eventType, 'follow_up_documented'), isNull(events.withdrawnAt), attachedDoc))
      .orderBy(events.eventDate),
    tx.select({ name: sql<string>`${documents.identityDetails}->'header'->'doctor'->>'value'`, docType: documents.docType, documentDate: documents.documentDate })
      .from(documents)
      .where(and(attachedDoc, sql`${documents.identityDetails}->'header'->'doctor'->>'value' is not null`))
      .orderBy(sql`${documents.documentDate} desc nulls last`, desc(documents.receivedAt)).limit(1),
  ])
  const superseded = new Set(followUps.map((f) => f.supersedesId).filter(Boolean))
  // Items raised by something the patient said have no trigger event: take the date from that statement.
  const stmtIds = looking.filter((m) => m.eventDate == null && m.window?.triggerKind === 'statement' && typeof m.window.triggerId === 'string')
    .map((m) => m.window!.triggerId as string)
  const stmts = stmtIds.length
    ? await tx.select({ id: patientStatements.id, at: patientStatements.createdAt, answer: patientStatements.answer }).from(patientStatements)
      .where(inArray(patientStatements.id, stmtIds))
    : []
  const stmtInstitution = new Map(stmts.map((x) => [x.id, (x.answer as { institutionName?: unknown } | null)?.institutionName]))
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const stmtDate = new Map(stmts.map((x) => {
    const a = (x.answer ?? {}) as { statedDate?: string | null; statedPrecision?: DatePrecision | null }
    return [x.id, a.statedDate ? { date: a.statedDate, precision: a.statedPrecision ?? 'day' } : { date: istDate(x.at.toISOString()), precision: 'day' as DatePrecision }]
  }))
  return {
    documents: docs.map((d) => ({
      id: d.id, docType: asDocType(d.docType), documentDate: d.documentDate, receivedAt: d.receivedAt.toISOString(), disputed: d.flags.patient_disputed === true,
    })),
    looking: looking.map((m) => {
      const st = m.eventDate == null && typeof m.window?.triggerId === 'string' ? stmtDate.get(m.window.triggerId) : undefined
      const date = st?.date ?? m.eventDate ?? m.eventDocDate
      return {
        id: m.id,
        expectedTypes: m.expectedTypes.map(asDocType).filter((t): t is DocType => t !== null),
        state: m.state as 'expected' | 'requested' | 'received',
        date,
        precision: (st?.precision ?? (m.eventDate ? m.precision : date ? 'day' : 'unknown')) as DatePrecision,
        // Where to ask: the hospital or lab that wrote the paper mentioning it, or the one the patient named
        institution: text(m.eventFields?.institution_name) ?? text(m.triggerInstitution) ?? (typeof m.window?.triggerId === 'string' ? text(stmtInstitution.get(m.window.triggerId)) : null),
      }
    }),
    writtenDates: followUps.filter((f) => f.eventDate && f.status !== 'rejected' && !superseded.has(f.id)).map((f) => ({
      id: f.id, what: text(f.fields.appointment_text), date: f.eventDate!, precision: f.precision, docType: asDocType(f.docType),
    })),
    doctor: doctorDoc ? { name: doctorDoc.name, docType: asDocType(doctorDoc.docType), date: doctorDoc.documentDate } : null,
    openRequests: open.n,
    lastStatement: last ? { at: last.at.toISOString(), confirmed: last.confirmation === 'confirmed' || last.confirmation === 'corrected' } : null,
    activeShares: shares.n,
  }
}

/**
 * Forwarding from the phone (FR-ING-04/05): the patient's email drop address once staff created one, and the clinic's
 * WhatsApp intake number once WhatsApp intake is configured. Null means that way in is not switched on here.
 */
export async function loadForwarding(tx: Tx, patientId: string): Promise<{ email: string | null; whatsapp: string | null }> {
  const domain = inboundDomain()
  const [alias] = domain
    ? await tx.select({ token: inboundAliases.aliasToken }).from(inboundAliases).where(and(eq(inboundAliases.patientId, patientId), isNull(inboundAliases.revokedAt)))
    : []
  const number = process.env.WHATSAPP_INTAKE_NUMBER?.trim()
  return {
    email: alias && domain ? dropAddress(alias.token, domain) : null,
    whatsapp: number && process.env.TWILIO_AUTH_TOKEN && process.env.PUBLIC_BASE_URL ? number : null,
  }
}
