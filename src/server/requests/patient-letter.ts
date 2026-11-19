// A family makes the request letter themselves (finale decision 1): from one missing paper, in English or Hindi.
// Same letter text and the same safe-name rule as the staff letter (the print page applies both); the hospital is taken
// from the item, never typed by the patient. Own patient only, audited with ids, at most 10 new letters an hour.
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { istDate } from '@/core/copy'
import { DOC_TYPES, type DocType, type LetterLang } from '@/core/types'
import type { Tx } from '@/db'
import { auditLog, documents, events, missingRecords, recordRequests } from '@/db/schema'
import type { AuditDetails } from '../audit'
import { now } from '../clock'
import { HttpError } from '../http'
import { assertPatientAccess } from '../patients'
import { requestMissingIds } from '../radar-ui/completeness'
import type { PatientSession } from '../session'
import type { RequestDocKey } from './letter'
import { createRequest } from './requests'

export const PATIENT_LETTER_LIMIT = { perHour: 10 }
const ACTIVE = ['drafted', 'sent', 'reminder_due', 'open_21d'] as const

type Ctx = { db: Tx; session: PatientSession; audit: (a: string, tt: string | null, id: string | null, d?: AuditDetails) => Promise<void> }

/** The hospital a missing paper should be asked from: where the mention came from, else the file that mentioned it. '' when the file does not say. */
async function institutionFor(tx: Tx, m: typeof missingRecords.$inferSelect): Promise<string> {
  const w = (m.matchWindow ?? {}) as { triggerKind?: unknown; triggerId?: unknown }
  if (m.triggerEventId) {
    const [e] = await tx.select({ fields: events.fields, documentId: events.documentId }).from(events).where(eq(events.id, m.triggerEventId))
    const f = (e?.fields ?? {}) as Record<string, unknown>
    const named = [f.referred_to_text, f.institution_name].find((x): x is string => typeof x === 'string' && x.trim().length >= 2)
    if (named) return named.trim()
    if (e?.documentId) {
      const [d] = await tx.select({ i: documents.institutionName }).from(documents).where(eq(documents.id, e.documentId))
      if (d?.i) return d.i.trim()
    }
  } else if (w.triggerKind === 'document' && typeof w.triggerId === 'string') {
    const [d] = await tx.select({ i: documents.institutionName }).from(documents).where(eq(documents.id, w.triggerId))
    if (d?.i) return d.i.trim()
  }
  return ''
}

/** Creates (or returns the open) letter for one of the signed-in family's own missing papers. */
export async function createPatientLetter(ctx: Ctx, input: { missingId: string; lang: LetterLang }): Promise<{ requestId: string; printUrl: string; existing: boolean }> {
  const patientId = ctx.session.patientId
  await assertPatientAccess(ctx, patientId)
  const [m] = await ctx.db.select().from(missingRecords).where(and(eq(missingRecords.id, input.missingId), eq(missingRecords.patientId, patientId), eq(missingRecords.mode, 'production')))
  if (!m) throw new HttpError(404, 'not_found', 'Not found') // someone else's item looks exactly like one that does not exist
  const printUrl = (id: string) => `/print/request/${id}?lang=${input.lang}`

  // One open letter per paper: asking again opens the same letter.
  const mine = await ctx.db.select().from(recordRequests).where(and(eq(recordRequests.patientId, patientId), inArray(recordRequests.state, [...ACTIVE])))
  const open = mine.find((r) => requestMissingIds(r).includes(m.id))
  if (open) return { requestId: open.id, printUrl: printUrl(open.id), existing: true }
  if (m.state !== 'expected' && m.state !== 'requested') throw new HttpError(409, 'item_not_open', 'That paper is no longer being looked for')

  const recent = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(and(
    eq(auditLog.action, 'request.patient_letter'), eq(auditLog.actorId, ctx.session.caregiverId ?? patientId), gt(auditLog.at, sql`now() - interval '1 hour'`)))
  if ((recent[0]?.n ?? 0) >= PATIENT_LETTER_LIMIT.perHour) throw new HttpError(429, 'rate_limited', 'Too many letters in the last hour. Please try again later.')

  const win = (m.matchWindow ?? {}) as { from?: unknown; to?: unknown }
  const today = istDate((await now(m.orgId)).toISOString())
  const from = typeof win.from === 'string' ? win.from : undefined
  const toRaw = typeof win.to === 'string' ? win.to : undefined
  const to = toRaw && toRaw < today ? toRaw : today
  const documentsWanted = m.expectedTypes.filter((t): t is DocType => (DOC_TYPES as readonly string[]).includes(t)) as RequestDocKey[]
  const { id } = await createRequest(ctx, {
    missingIds: [m.id], institution: await institutionFor(ctx.db, m), documents: documentsWanted.length ? documentsWanted : ['discharge_summary'],
    dateRange: from && from <= to ? { from, to } : undefined, lang: input.lang,
  })
  await ctx.audit('request.patient_letter', 'record_request', id, { patientId, missingId: m.id, lang: input.lang })
  return { requestId: id, printUrl: printUrl(id), existing: false }
}
