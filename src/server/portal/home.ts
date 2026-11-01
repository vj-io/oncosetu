// Data behind the patient home page. Reads only; the wording is built by summary.ts.
import { and, count, desc, eq, gt, inArray, isNull, notInArray } from 'drizzle-orm'
import { istDate } from '@/core/copy'
import type { DatePrecision, DocType } from '@/core/types'
import { DOC_TYPES } from '@/core/types'
import type { Tx } from '@/db'
import { documents, events, missingRecords, patientStatements, recordRequests, shareLinks } from '@/db/schema'
import { now } from '../clock'
import type { HomeData } from './summary'

const asDocType = (t: string | null): DocType | null => ((DOC_TYPES as readonly string[]).includes(t ?? '') ? (t as DocType) : null)

export const OPEN_REQUEST_STATES = ['drafted', 'sent', 'reminder_due', 'open_21d'] as const

export async function loadHomeData(tx: Tx, orgId: string, patientId: string): Promise<HomeData> {
  const at = await now(orgId)
  const [docs, looking, [open], [last], [shares]] = await Promise.all([
    tx.select({ id: documents.id, docType: documents.docType, documentDate: documents.documentDate, receivedAt: documents.receivedAt })
      .from(documents)
      .where(and(
        eq(documents.patientId, patientId), isNull(documents.duplicateOf),
        notInArray(documents.attachState, ['rejected', 'detached']), notInArray(documents.status, ['quarantined']),
      ))
      .orderBy(desc(documents.receivedAt)).limit(50),
    tx.select({
      id: missingRecords.id, expectedTypes: missingRecords.expectedTypes, state: missingRecords.state, window: missingRecords.matchWindow,
      eventDate: events.eventDate, eventDocDate: events.documentDate, precision: events.datePrecision,
    }).from(missingRecords).leftJoin(events, eq(events.id, missingRecords.triggerEventId))
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
  // Items raised by something the patient said have no trigger event: take the date from that statement.
  const stmtIds = looking.filter((m) => m.eventDate == null && m.window?.triggerKind === 'statement' && typeof m.window.triggerId === 'string')
    .map((m) => m.window!.triggerId as string)
  const stmts = stmtIds.length
    ? await tx.select({ id: patientStatements.id, at: patientStatements.createdAt, answer: patientStatements.answer }).from(patientStatements)
      .where(inArray(patientStatements.id, stmtIds))
    : []
  const stmtDate = new Map(stmts.map((x) => {
    const a = (x.answer ?? {}) as { statedDate?: string | null; statedPrecision?: DatePrecision | null }
    return [x.id, a.statedDate ? { date: a.statedDate, precision: a.statedPrecision ?? 'day' } : { date: istDate(x.at.toISOString()), precision: 'day' as DatePrecision }]
  }))
  return {
    documents: docs.map((d) => ({
      id: d.id, docType: asDocType(d.docType), documentDate: d.documentDate, receivedAt: d.receivedAt.toISOString(),
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
      }
    }),
    openRequests: open.n,
    lastStatement: last ? { at: last.at.toISOString(), confirmed: last.confirmation === 'confirmed' || last.confirmation === 'corrected' } : null,
    activeShares: shares.n,
  }
}
