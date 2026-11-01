// Verification, bulk verification and conflict resolution (FR-VER-01..03, FR-LED-05, E-LED-03/05/07/08).
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { events, evidence, verifications } from '@/db/schema'
import type { VerificationStatus } from '@/core/types'
import { now } from '../clock'
import { HttpError, type RouteCtx } from '../http'
import { assertPatientAccess } from '../patients'
import { checkVerification, editedVersion, itemsById, resolvedKey, type ItemView, type LedgerView } from './core'
import { loadLedger, viewedEventIds } from './record'

type Ctx<B> = RouteCtx<'staff', B, undefined>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function idParam(ctx: { params: Record<string, string | string[]> }): string {
  const v = ctx.params.id
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(404, 'not_found', 'Not found')
  return v
}

const fieldValue = z.union([z.string().trim().max(500), z.number().finite(), z.array(z.string().trim().max(200)).max(50)])
export const verifyBody = z.object({
  action: z.enum(['verify', 'edit', 'reject', 'dispute']),
  reason: z.string().trim().max(500).optional(),
  fields: z.record(z.string().max(40), fieldValue).optional(),
  rowVersion: z.number().int().min(0),
})
export type VerifyBody = z.infer<typeof verifyBody>

const TO_STATUS = { verify: 'verified_matches_source', edit: 'edited', reject: 'rejected', dispute: 'disputed' } as const satisfies Record<string, VerificationStatus>

/** E-LED-08: the item changed under you. Returns the current state so the UI re-reads. */
function stale(current: Record<string, unknown>, message = 'Someone else changed this item. Showing the latest version.') {
  return NextResponse.json({ error: { code: 'stale', message }, current }, { status: 409 })
}

async function loadFor(ctx: Ctx<unknown>, eventId: string) {
  const [ev] = await ctx.db.select().from(events).where(eq(events.id, eventId))
  if (!ev) throw new HttpError(404, 'not_found', 'Not found')
  await assertPatientAccess(ctx, ev.patientId)
  const ledger = await loadLedger(ctx.db, ev.patientId, ctx.session, await now(ctx.session.orgId))
  return { ev, ledger, items: itemsById(ledger) }
}

/** The current state of an event that is no longer in the ledger (superseded by an edit, withdrawn, rejected). */
async function currentOf(ctx: Ctx<unknown>, ev: typeof events.$inferSelect) {
  const [next] = await ctx.db.select({ id: events.id, rowVersion: events.rowVersion, status: events.verificationStatus })
    .from(events).where(eq(events.supersedesId, ev.id)).limit(1)
  return { id: ev.id, rowVersion: ev.rowVersion, verificationStatus: ev.verificationStatus, withdrawn: !!ev.withdrawnAt, supersededBy: next?.id ?? null }
}

async function recordVerification(ctx: Ctx<unknown>, ev: { id: string; patientId: string }, action: 'verify' | 'edit' | 'reject' | 'dispute' | 'resolve_conflict', from: VerificationStatus, to: VerificationStatus, reason: string | null, viewed: boolean) {
  await ctx.db.insert(verifications).values({
    orgId: ctx.session.orgId, patientId: ev.patientId, eventId: ev.id, action, fromStatus: from, toStatus: to, actorKind: 'staff',
    actorId: ctx.session.staffId, role: ctx.session.role, reason, viewedSource: viewed,
  })
}

/** Conditional status write on row_version (the DB-level guard for E-LED-08). false → someone got there first. */
async function bump(ctx: Ctx<unknown>, id: string, rowVersion: number, set: Partial<typeof events.$inferInsert> = {}) {
  const r = await ctx.db.update(events).set({ ...set, rowVersion: sql`${events.rowVersion} + 1`, updatedAt: new Date() })
    .where(and(eq(events.id, id), eq(events.rowVersion, rowVersion))).returning({ id: events.id, rowVersion: events.rowVersion })
  return r[0] ?? null
}

/** POST /api/events/[id]/verify — verify | edit (new version) | reject | dispute, with tier rules and optimistic concurrency. */
export async function verifyEvent(ctx: Ctx<VerifyBody>, eventId: string) {
  const { ev, items } = await loadFor(ctx, eventId)
  const item = items.get(eventId)
  if (!item) return stale(await currentOf(ctx, ev), 'This item is no longer in the current record. Showing the latest version.')
  const b = ctx.body
  const err = checkVerification({ role: ctx.session.role, tier: item.tier, action: b.action, eventType: ev.eventType, reason: b.reason, fields: b.fields })
  if (err) throw new HttpError(err.status, err.code, err.message)
  if (ev.rowVersion !== b.rowVersion) return stale(await currentOf(ctx, ev))

  const viewed = (await viewedEventIds(ctx.db, ctx.session.staffId, [ev.id, ...(ev.supersedesId ? [ev.supersedesId] : [])])).size > 0
  const reason = b.reason?.trim() || null
  const at = await now(ctx.session.orgId)

  if (b.action === 'edit') {
    if (!(await bump(ctx, ev.id, b.rowVersion))) return stale(await currentOf(ctx, ev))
    const [next] = await ctx.db.insert(events).values(editedVersion(ev, b.fields!, ctx.session, at)).returning({ id: events.id, rowVersion: events.rowVersion })
    // Evidence is re-linked: the new version points at the same quotes as the original.
    const ev0 = await ctx.db.select({
      orgId: evidence.orgId, patientId: evidence.patientId, documentId: evidence.documentId, pageNo: evidence.pageNo, charStart: evidence.charStart,
      charEnd: evidence.charEnd, quote: evidence.quote, quoteSha256: evidence.quoteSha256, bbox: evidence.bbox, statementId: evidence.statementId,
      tStart: evidence.tStart, tEnd: evidence.tEnd, fhirResourceRef: evidence.fhirResourceRef,
    }).from(evidence).where(eq(evidence.eventId, ev.id))
    if (ev0.length) await ctx.db.insert(evidence).values(ev0.map((v) => ({ ...v, eventId: next.id })))
    await recordVerification(ctx, { id: next.id, patientId: ev.patientId }, 'edit', ev.verificationStatus, 'edited', reason, viewed)
    await ctx.audit('event.edit', 'event', next.id, { patientId: ev.patientId, previousId: ev.id, fields: Object.keys(b.fields!), viewedSource: viewed, tier: item.tier })
    return { ok: true, eventId: next.id, previousId: ev.id, status: 'edited', rowVersion: next.rowVersion, viewedSource: viewed }
  }

  const to = b.action === 'verify' && ev.verificationStatus === 'edited' ? 'edited' : TO_STATUS[b.action] // an edit is already a verified status
  const done = await bump(ctx, ev.id, b.rowVersion, { verificationStatus: to })
  if (!done) return stale(await currentOf(ctx, ev))
  await recordVerification(ctx, ev, b.action, ev.verificationStatus, to, reason, viewed)
  await ctx.audit(`event.${b.action}`, 'event', ev.id, { patientId: ev.patientId, from: ev.verificationStatus, to, viewedSource: viewed, tier: item.tier })
  return { ok: true, eventId: ev.id, status: to, rowVersion: done.rowVersion, viewedSource: viewed }
}

export const bulkBody = z.object({ eventIds: z.array(z.string().regex(UUID)).min(1).max(500) })

/** Why an item cannot be bulk-verified by this actor, or null if it can. */
export function bulkSkipReason(item: ItemView | undefined): string[] | null {
  if (!item) return ['not_in_record']
  if (item.status !== 'unverified') return ['not_unverified']
  if (!item.bulk.eligible) return item.bulk.reasons
  if (item.permits.verify !== true) return ['clinician_tier']
  return null
}

/** POST /api/patients/[id]/verify-bulk — verifies only FR-LED-05-eligible, tier-permitted, unverified items; reports the rest. */
export async function verifyBulk(ctx: Ctx<z.infer<typeof bulkBody>>, patientId: string) {
  await assertPatientAccess(ctx, patientId)
  const ledger: LedgerView = await loadLedger(ctx.db, patientId, ctx.session, await now(ctx.session.orgId))
  const items = itemsById(ledger)
  const viewed = await viewedEventIds(ctx.db, ctx.session.staffId, ctx.body.eventIds)
  const verified: string[] = []
  const skipped: { id: string; reasons: string[] }[] = []
  for (const id of [...new Set(ctx.body.eventIds)]) {
    const item = items.get(id)
    const why = bulkSkipReason(item)
    if (why) { skipped.push({ id, reasons: why }); continue }
    if (!(await bump(ctx, id, item!.rowVersion, { verificationStatus: 'verified_matches_source' }))) { skipped.push({ id, reasons: ['stale'] }); continue }
    await recordVerification(ctx, { id, patientId }, 'verify', 'unverified', 'verified_matches_source', null, viewed.has(id))
    verified.push(id)
  }
  if (verified.length) await ctx.audit('event.verify_bulk', 'patient', patientId, { count: verified.length, eventIds: verified })
  return { ok: true, verified, skipped }
}

export const resolveBody = z.object({ note: z.string().trim().min(1).max(500), keepEventId: z.string().regex(UUID).optional() })

/**
 * POST /api/events/[id]/resolve (clinician) — marks every open conflict involving this event resolved, with a note.
 * keepEventId (one of the event sides) is verified as matching source; the other side is kept as documented.
 */
export async function resolveConflict(ctx: Ctx<z.infer<typeof resolveBody>>, eventId: string) {
  const { ev, ledger } = await loadFor(ctx, eventId)
  const mine = ledger.conflicts.filter((c) => c.sides.some((s) => s.id === eventId))
  if (!mine.length) throw new HttpError(409, 'no_conflict', 'This item has no open conflict.')
  const keep = ctx.body.keepEventId
  if (keep && !mine.some((c) => c.sides.some((s) => s.kind === 'event' && s.id === keep))) throw new HttpError(400, 'invalid_keep', 'keepEventId must be one side of the conflict.')
  const viewed = await viewedEventIds(ctx.db, ctx.session.staffId)
  const touched = new Map<string, { flags: Record<string, boolean>; rowVersion: number; status: VerificationStatus }>()
  for (const c of mine) {
    const [a, b] = c.sides
    for (const [s, other] of [[a, b], [b, a]] as const) {
      if (s.kind !== 'event') continue
      const t = touched.get(s.id) ?? { flags: {}, rowVersion: s.rowVersion!, status: s.status! }
      t.flags[resolvedKey(other.id)] = true
      touched.set(s.id, t)
    }
  }
  for (const [id, t] of touched) {
    const to: VerificationStatus = id === keep && t.status !== 'edited' ? 'verified_matches_source' : t.status
    const [row] = await ctx.db.select({ flags: events.flags }).from(events).where(eq(events.id, id))
    if (!(await bump(ctx, id, t.rowVersion, { flags: { ...row.flags, ...t.flags, conflict: false }, verificationStatus: to }))) {
      throw new HttpError(409, 'stale', 'Someone else changed one of these items. Reload and try again.') // rolls back the whole resolution
    }
    await recordVerification(ctx, { id, patientId: ev.patientId }, 'resolve_conflict', t.status, to, ctx.body.note, viewed.has(id))
  }
  await ctx.audit('conflict.resolve', 'event', eventId, { patientId: ev.patientId, eventIds: [...touched.keys()], ...(keep ? { keepEventId: keep } : {}) })
  return { ok: true, resolved: mine.length, eventIds: [...touched.keys()] }
}
