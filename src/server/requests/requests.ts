// Records Request Kit (FR-REQ-01..06, J4): create, track (lazy, demo-clock aware), mark given, withdraw, unobtainable.
// Nothing is ever sent to an institution (FR-REQ-05); the only outbound message is ONE neutral reminder per threshold
// to the patient's primary contact (FR-REQ-04).
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { brandFor, formatDateIN, istDate } from '@/core/copy'
import { transitionMissing } from '@/core/radar'
import type { Disclosure, Lang, LetterLang, RequestState } from '@/core/types'
import type { Tx } from '@/db'
import { missingRecords, patients, recordRequests } from '@/db/schema'
import { tr } from '@/i18n/requests'
import { writeAudit, type AuditDetails } from '../audit'
import { now } from '../clock'
import { HttpError } from '../http'
import { sendMessage } from '../outbox'
import { assertPatientAccess } from '../patients'
import { can } from '../rbac'
import { primaryContactTarget } from '../registration/contact'
import { sessionRole, type Session } from '../session'
import { requestMissingIds, settleRequests } from '../radar-ui/completeness'
import type { L2 } from '../radar-ui/wording'
import { guardFree, neutralName, patientInstitution, requestDocLabel, type RequestDocKey } from './letter'
import { reminderPlan } from './reminders'

type Ctx = {
  db: Tx; session: Session
  audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}
type Row = typeof recordRequests.$inferSelect

const ACTIVE: RequestState[] = ['sent', 'reminder_due', 'open_21d']
const TERMINAL: RequestState[] = ['fulfilled', 'unobtainable', 'withdrawn']

const actorOf = (s: Session) => s.kind === 'staff'
  ? { kind: 'staff' as const, id: s.staffId }
  : { kind: s.kind, id: s.caregiverId ?? s.patientId }

function assertCanManage(s: Session) {
  if (!can(sessionRole(s), 'request.manage')) throw new HttpError(403, 'forbidden', 'Not allowed')
}

async function disclosureOf(tx: Tx, patientId: string): Promise<Disclosure> {
  const [p] = await tx.select({ d: patients.disclosureStatus }).from(patients).where(eq(patients.id, patientId))
  return p?.d ?? 'unknown'
}

/** Move linked items that are still `expected` to `requested` (a request for them has been given to the hospital). Returns the ids moved. */
async function markItemsRequested(tx: Tx, ids: string[], at: Date, actorId: string | null): Promise<string[]> {
  if (!ids.length) return []
  const rows = await tx.select({ id: missingRecords.id, state: missingRecords.state }).from(missingRecords).where(inArray(missingRecords.id, ids))
  const toMove = rows.filter((r) => transitionMissing(r.state, { type: 'request' }).ok).map((r) => r.id)
  if (!toMove.length) return []
  return (await tx.update(missingRecords).set({ state: 'requested', stateChangedAt: at, stateChangedBy: actorId })
    .where(and(inArray(missingRecords.id, toMove), eq(missingRecords.state, 'expected'))).returning({ id: missingRecords.id })).map((x) => x.id)
}

const requestedDetails = (patientId: string, requestId: string) => ({ patientId, action: 'request', from: 'expected', to: 'requested', requestId })

/**
 * Lazy tracking on read: recompute each request's state with the org clock, persist changes, and send the reminder a
 * threshold is due for. Idempotent: a reminder column is stamped by a conditional UPDATE, and the message goes out
 * only if this call won that update.
 */
export async function refreshRequests(tx: Tx, orgId: string, patientId: string): Promise<Row[]> {
  const at = await now(orgId)
  const rows = await tx.select().from(recordRequests).where(eq(recordRequests.patientId, patientId)).orderBy(desc(recordRequests.createdAt))
  let disclosure: Disclosure | null = null
  for (const r of rows) {
    const plan = reminderPlan(r, at)
    if (plan.state !== r.state) {
      await tx.update(recordRequests).set({ state: plan.state, updatedAt: at }).where(eq(recordRequests.id, r.id))
      r.state = plan.state
    }
    if (ACTIVE.includes(r.state)) {
      for (const m of await markItemsRequested(tx, requestMissingIds(r), at, null)) {
        await writeAudit(tx, { orgId, actorId: null, actorRole: 'system', action: 'missing.transition', targetType: 'missing_record', targetId: m, details: requestedDetails(patientId, r.id) })
      }
    }
    if (!plan.stamp7 && !plan.stamp21) continue
    const won = await tx.update(recordRequests).set({
      ...(plan.stamp7 ? { reminder7SentAt: at } : {}), ...(plan.stamp21 ? { reminder21SentAt: at } : {}),
    }).where(and(eq(recordRequests.id, r.id), isNull(plan.stamp21 ? recordRequests.reminder21SentAt : recordRequests.reminder7SentAt)))
      .returning({ id: recordRequests.id })
    if (!won.length) continue
    if (plan.stamp7) r.reminder7SentAt = at
    if (plan.stamp21) r.reminder21SentAt = at
    disclosure ??= await disclosureOf(tx, patientId)
    const to = await primaryContactTarget(tx, patientId)
    if (to && plan.send) {
      const lang = to.lang
      await sendMessage(tx, {
        orgId, patientId, toPhone: to.phone, channel: 'sms', templateKey: `request.${plan.send}`, lang,
        body: tr(lang, plan.send, {
          brand: brandFor(disclosure),
          institution: neutralName(r.institution, disclosure) ?? tr(lang, 'reminderInstitutionFallback'),
          date: formatDateIN(istDate(r.sentAt!.toISOString()), lang),
        }),
      })
    }
    await writeAudit(tx, {
      orgId, actorId: null, actorRole: 'system', action: 'request.reminder', targetType: 'record_request', targetId: r.id,
      details: { patientId, threshold: plan.send === 'reminder21' ? 21 : 7, sent: !!to },
    })
  }
  return rows
}

export type RequestView = {
  id: string; state: RequestState; institution: string; institutionPatientId: string | null
  documents: { key: string; label: L2 }[]; dateRange: { from?: string; to?: string } | null; lang: Lang
  createdAt: string; sentAt: string | null; fulfilledAt: string | null; daysOpen: number | null
  reminder7SentAt: string | null; reminder21SentAt: string | null; missingIds: string[]
}

/** Requests for one patient, refreshed. Staff see clinical labels; the patient side sees neutral ones (FR-CON-07). */
export async function listRequests(tx: Tx, orgId: string, patientId: string, audience: 'staff' | 'patient'): Promise<RequestView[]> {
  const rows = await refreshRequests(tx, orgId, patientId)
  const disclosure: Disclosure = audience === 'staff' ? 'cleared' : await disclosureOf(tx, patientId)
  const at = await now(orgId)
  return rows.map((r) => {
    const p = (r.letterPayload ?? {}) as { institutionPatientId?: string }
    return {
      id: r.id, state: r.state, lang: r.lang,
      institution: audience === 'staff' ? r.institution : patientInstitution(r.institution, disclosure),
      institutionPatientId: audience === 'staff' ? p.institutionPatientId ?? null : guardFree(p.institutionPatientId, disclosure),
      documents: r.documents.map((key) => ({ key, label: { en: requestDocLabel(key, disclosure, 'en') ?? key, hi: requestDocLabel(key, disclosure, 'hi') ?? key, hinglish: requestDocLabel(key, disclosure, 'hinglish') ?? key } })),
      dateRange: r.dateRange ?? null,
      createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null, fulfilledAt: r.fulfilledAt?.toISOString() ?? null,
      daysOpen: r.sentAt && ACTIVE.includes(r.state) ? Math.floor((+at - +r.sentAt) / 86_400_000) : null,
      reminder7SentAt: r.reminder7SentAt?.toISOString() ?? null, reminder21SentAt: r.reminder21SentAt?.toISOString() ?? null,
      missingIds: requestMissingIds(r),
    }
  })
}

export type CreateRequestInput = {
  patientId?: string; missingIds: string[]; institution: string; institutionPatientId?: string
  documents: RequestDocKey[]; dateRange?: { from?: string; to?: string }; lang: LetterLang
}

export async function createRequest(ctx: Ctx, input: CreateRequestInput): Promise<{ id: string }> {
  assertCanManage(ctx.session)
  const patientId = ctx.session.kind === 'staff' ? input.patientId : ctx.session.patientId
  if (!patientId) throw new HttpError(400, 'patient_required', 'Choose a patient')
  await assertPatientAccess(ctx, patientId)
  const { from, to } = input.dateRange ?? {}
  if (from && to && from > to) throw new HttpError(400, 'invalid_range', 'The start date is after the end date')

  const missingIds = [...new Set(input.missingIds)]
  if (missingIds.length) {
    const items = await ctx.db.select({ id: missingRecords.id, patientId: missingRecords.patientId, mode: missingRecords.mode, state: missingRecords.state })
      .from(missingRecords).where(inArray(missingRecords.id, missingIds))
    const ok = items.filter((m) => m.patientId === patientId && m.mode === 'production')
    if (ok.length !== missingIds.length) throw new HttpError(404, 'not_found', 'Not found')
    if (ok.some((m) => m.state !== 'expected' && m.state !== 'requested')) throw new HttpError(409, 'item_not_open', 'That item is no longer waiting for a document')
  }
  const actor = actorOf(ctx.session)
  const [row] = await ctx.db.insert(recordRequests).values({
    orgId: ctx.session.orgId, patientId, missingRecordId: missingIds[0] ?? null,
    institution: input.institution.trim(), documents: [...new Set(input.documents)], dateRange: input.dateRange ?? null, lang: input.lang,
    letterPayload: { missingIds, institutionPatientId: input.institutionPatientId?.trim() || null },
    state: 'drafted', createdByKind: actor.kind, createdBy: actor.id,
  }).returning({ id: recordRequests.id })
  await ctx.audit('request.create', 'record_request', row.id, { patientId, missingIds, lang: input.lang })
  return { id: row.id }
}

/** A request of a patient the session may act for (uniform 404 otherwise). */
async function ownedRequest(ctx: Ctx, id: string): Promise<Row> {
  assertCanManage(ctx.session)
  const [r] = await ctx.db.select().from(recordRequests).where(eq(recordRequests.id, id))
  if (!r) throw new HttpError(404, 'not_found', 'Not found')
  await assertPatientAccess(ctx, r.patientId)
  return r
}

/** "Given to the hospital on <date>" (FR-REQ-03: the patient confirms the date; staff may record it). */
export async function markSent(ctx: Ctx, id: string, sentOn?: string): Promise<{ state: RequestState; sentAt: string }> {
  const r = await ownedRequest(ctx, id)
  if (r.state !== 'drafted') throw new HttpError(409, 'already_sent', 'This request has already been marked as given')
  const at = await now(r.orgId)
  const today = istDate(at.toISOString())
  if (sentOn && sentOn > today) throw new HttpError(400, 'invalid_date', 'The date cannot be in the future')
  const sentAt = sentOn && sentOn !== today ? new Date(`${sentOn}T12:00:00+05:30`) : at // a chosen day is stored as noon IST
  await ctx.db.update(recordRequests).set({ state: 'sent', sentAt, updatedAt: at }).where(eq(recordRequests.id, id))
  for (const m of await markItemsRequested(ctx.db, requestMissingIds(r), at, ctx.session.kind === 'staff' ? ctx.session.staffId : null)) {
    await ctx.audit('missing.transition', 'missing_record', m, requestedDetails(r.patientId, id))
  }
  await ctx.audit('request.mark_sent', 'record_request', id, { patientId: r.patientId })
  return { state: 'sent', sentAt: sentAt.toISOString() }
}

export async function withdrawRequest(ctx: Ctx, id: string): Promise<{ state: RequestState }> {
  const r = await ownedRequest(ctx, id)
  if (TERMINAL.includes(r.state)) throw new HttpError(409, 'closed', 'This request is already closed')
  await ctx.db.update(recordRequests).set({ state: 'withdrawn', updatedAt: await now(r.orgId) }).where(eq(recordRequests.id, id))
  await ctx.audit('request.withdraw', 'record_request', id, { patientId: r.patientId })
  return { state: 'withdrawn' }
}

/** The hospital says the records cannot be provided: the request closes and its open items become unobtainable (E-RAD-02). */
export async function markRequestUnobtainable(ctx: Ctx, id: string, reason: string): Promise<{ state: RequestState; items: string[] }> {
  const r = await ownedRequest(ctx, id)
  if (TERMINAL.includes(r.state)) throw new HttpError(409, 'closed', 'This request is already closed')
  const why = reason.trim().slice(0, 500)
  if (!why) throw new HttpError(400, 'reason_required', 'A reason is required')
  const at = await now(r.orgId)
  await ctx.db.update(recordRequests).set({ state: 'unobtainable', updatedAt: at, letterPayload: { ...(r.letterPayload ?? {}), unobtainableReason: why } })
    .where(eq(recordRequests.id, id))
  const ids = requestMissingIds(r)
  const items = ids.length ? await ctx.db.select({ id: missingRecords.id, state: missingRecords.state }).from(missingRecords).where(inArray(missingRecords.id, ids)) : []
  const moved: string[] = []
  for (const m of items) {
    if (m.state === 'received' || !transitionMissing(m.state, { type: 'unobtainable', reason: why }).ok) continue // a proposed match waits for a person
    await ctx.db.update(missingRecords).set({ state: 'unobtainable', reason: why, stateChangedAt: at, stateChangedBy: ctx.session.kind === 'staff' ? ctx.session.staffId : null })
      .where(eq(missingRecords.id, m.id))
    moved.push(m.id)
    await ctx.audit('missing.transition', 'missing_record', m.id, { patientId: r.patientId, action: 'unobtainable', from: m.state, to: 'unobtainable' })
  }
  for (const m of moved) await settleRequests(ctx.db, r.orgId, r.patientId, m) // other requests covering the same items
  await ctx.audit('request.unobtainable', 'record_request', id, { patientId: r.patientId })
  return { state: 'unobtainable', items: moved }
}
