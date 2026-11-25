// A patient asks the clinic for a copy of a paper they cannot open in the portal (FR-CON-07 keeps staff-uploaded papers
// closed until disclosure is cleared). Records must be issued within 72 hours of a request (Indian Medical Council
// regulations, 2002, 1.3.2), so the request goes on the records to-do list with that deadline; a person gives the copy,
// or the clinician clears disclosure with the patient. The request is a mark on the document and an audit row, never text.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents, patients } from '@/db/schema'
import type { AuditDetails } from '../audit'
import { now } from '../clock'
import { decryptField } from '../crypto'
import { HttpError } from '../http'
import { peopleWithConsent } from '../ledger/queue'
import { log } from '../log'
import { patientMayOpen, portalActor } from '../pipeline/actions'
import { UNREADABLE_NAME } from '../registration/search'
import type { PatientSession, Session } from '../session'

/** Hours within which a requested copy is given. */
export const COPY_DUE_HOURS = 72

/** documents.flags.copy_request */
export type CopyRequest = { at: string; by: 'patient' | 'caregiver'; givenAt?: string }

export const copyRequestOf = (flags: unknown): CopyRequest | null => {
  const c = (flags as { copy_request?: CopyRequest } | null)?.copy_request
  return c && typeof c.at === 'string' ? c : null
}
export const copyDue = (c: CopyRequest) => new Date(Date.parse(c.at) + COPY_DUE_HOURS * 3_600_000).toISOString()

type Ctx<S> = { db: Tx; session: S; audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void> }

/** The patient or caregiver asks for a copy. One open request per paper; asking again while it is open changes nothing. */
export async function requestCopy(ctx: Ctx<PatientSession>, documentId: string): Promise<{ ok: true; at: string }> {
  const s = ctx.session
  const [d] = await ctx.db.select({
    patientId: documents.patientId, attachState: documents.attachState, status: documents.status, flags: documents.flags,
    uploadedByKind: documents.uploadedByKind, uploadedById: documents.uploadedById,
  }).from(documents).where(eq(documents.id, documentId))
  // Uniform 404: another patient's paper, a held, rejected or detached one, or a quarantined file all look the same.
  if (!d || d.patientId !== s.patientId || !['auto', 'attached'].includes(d.attachState) || d.status === 'quarantined') throw new HttpError(404, 'not_found', 'Not found')
  const disclosure = await disclosureOf(ctx.db, s.patientId)
  if (patientMayOpen(d, disclosure, portalActor(s))) throw new HttpError(409, 'already_open', 'You can already open this paper')
  const open = copyRequestOf(d.flags)
  if (open && !open.givenAt) return { ok: true, at: open.at }
  const at = (await now(s.orgId)).toISOString()
  const req: CopyRequest = { at, by: s.kind }
  await ctx.db.update(documents).set({ flags: sql`${documents.flags} || ${JSON.stringify({ copy_request: req })}::jsonb`, updatedAt: new Date(at) }).where(eq(documents.id, documentId))
  await ctx.audit('document.copy_requested', 'document', documentId, { patientId: s.patientId })
  return { ok: true, at }
}

async function disclosureOf(tx: Tx, patientId: string): Promise<string> {
  const [p] = await tx.select({ disclosure: patients.disclosureStatus }).from(patients).where(eq(patients.id, patientId))
  return p?.disclosure ?? 'unknown'
}

/** Records or clinician staff record that the copy was given (by hand, by email, or by clearing disclosure). */
export async function giveCopy(ctx: Ctx<Session>, documentId: string): Promise<{ ok: true }> {
  const [d] = await ctx.db.select({ flags: documents.flags }).from(documents).where(eq(documents.id, documentId))
  const c = d ? copyRequestOf(d.flags) : null
  if (!c || c.givenAt) throw new HttpError(409, 'no_open_request', 'No copy request is waiting for this paper')
  const givenAt = (await now(ctx.session.orgId)).toISOString()
  await ctx.db.update(documents).set({ flags: sql`${documents.flags} || ${JSON.stringify({ copy_request: { ...c, givenAt } })}::jsonb`, updatedAt: new Date(givenAt) }).where(eq(documents.id, documentId))
  await ctx.audit('document.copy_given', 'document', documentId, { hoursTaken: Math.round((Date.parse(givenAt) - Date.parse(c.at)) / 3_600_000) })
  return { ok: true }
}

export type CopyRow = { patientId: string; name: string; documentId: string; docType: string | null; askedAt: string; dueAt: string; overdue: boolean }

/**
 * Open copy requests across patients, oldest first, for the records to-do list. Only patients with an active 'store' consent
 * are named; the others are counted.
 */
export async function loadCopyRequests(tx: Tx, at: Date): Promise<{ rows: CopyRow[]; withoutConsent: number }> {
  const open = await tx.select({ id: documents.id, patientId: documents.patientId, docType: documents.docType, flags: documents.flags }).from(documents)
    .where(and(sql`${documents.flags} ? 'copy_request'`, sql`not (${documents.flags}->'copy_request' ? 'givenAt')`, inArray(documents.attachState, ['auto', 'attached']), isNull(documents.duplicateOf)))
  if (!open.length) return { rows: [], withoutConsent: 0 }
  const { people, consented } = await peopleWithConsent(tx, [...new Set(open.map((o) => o.patientId))])
  const names = new Map<string, string>()
  for (const p of people) {
    if (p.status !== 'active' || !consented.has(p.id)) continue
    try { names.set(p.id, decryptField(p.nameEnc)) } catch (e) {
      log.error('copy request name could not be decrypted', { patientId: p.id, errorCode: (e as { code?: unknown }).code ?? (e as Error).name })
      names.set(p.id, UNREADABLE_NAME)
    }
  }
  const rows: CopyRow[] = []
  let withoutConsent = 0
  for (const o of open) {
    const c = copyRequestOf(o.flags)!
    if (!names.has(o.patientId)) { withoutConsent++; continue }
    const dueAt = copyDue(c)
    rows.push({ patientId: o.patientId, name: names.get(o.patientId)!, documentId: o.id, docType: o.docType, askedAt: c.at, dueAt, overdue: Date.parse(dueAt) < at.getTime() })
  }
  rows.sort((a, b) => a.askedAt.localeCompare(b.askedAt))
  return { rows, withoutConsent }
}
