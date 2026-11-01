// Human actions on a document (route handlers call these inside their RLS transaction; every one is audited).
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Tx } from '@/db'
import { documentPages, documents, events, evidence, snapshots } from '@/db/schema'
import { parseDate } from '@/core/dates'
import { DOC_TYPES, EXTRACTABLE_EVENT_TYPES } from '@/core/types'
import type { AuditDetails } from '@/server/audit'
import { HttpError } from '@/server/http'
import { assertPatientAccess } from '@/server/patients'
import type { Session } from '@/server/session'
import { gateAndDate, type Classified } from './core'
import { scheduleProcessing } from './ingest'
import { needsRunner } from './queries'
import { recomputeRadar } from './radar'
import type { PageRead } from './text'

type Ctx = {
  db: Tx; session: Session
  audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}
type Doc = typeof documents.$inferSelect
const notFound = () => new HttpError(404, 'not_found', 'Not found')
const ATTACHED = ['auto', 'attached'] as const

/** Loads a document visible under RLS and applies the patient access policy (uniform 404 for unknown ids). */
export async function loadDocument(ctx: Ctx, documentId: string): Promise<Doc> {
  const [d] = await ctx.db.select().from(documents).where(eq(documents.id, documentId))
  if (!d) throw notFound()
  await assertPatientAccess(ctx, d.patientId)
  return d
}

const staffId = (s: Session) => (s.kind === 'staff' ? s.staffId : null)

// ── identity decision (FR-ID-05) ────────────────────────────────────────────
export const attachSchema = z.object({ decision: z.enum(['attach', 'reject']), reason: z.string().trim().min(3).max(500) })

export async function decideAttachment(ctx: Ctx, d: Doc, body: z.infer<typeof attachSchema>) {
  if (d.attachState !== 'pending_decision') throw new HttpError(409, 'not_pending', 'This document is not waiting for an identity decision')
  if (d.status === 'processing' || d.status === 'queued') throw new HttpError(409, 'processing', 'Wait until processing stops')
  const attach = body.decision === 'attach'
  await ctx.db.update(documents).set({
    attachState: attach ? 'attached' : 'rejected', attachDecidedBy: staffId(ctx.session), attachDecidedAt: new Date(), attachReason: body.reason,
    status: attach ? 'queued' : 'done', attempts: 0, updatedAt: new Date(),
  }).where(eq(documents.id, d.id))
  await ctx.audit('document.identity_decision', 'document', d.id, { decision: body.decision, identityResult: d.identityResult })
  if (attach) scheduleProcessing(d.id, d.orgId)
  else await recomputeRadar(ctx.db, d.orgId, d.patientId)
  return { ok: true, attachState: attach ? 'attached' : 'rejected' }
}

// ── detach (FR-ID-06, E-LED-06) ─────────────────────────────────────────────
export const detachSchema = z.object({ reason: z.string().trim().min(3).max(500) })

/**
 * Erratum stored on the document as `documents.flags.erratum` (read by the Ledger / passport):
 *   { detachedAt: ISO, detachedBy: staffId, reason: string, withdrawnEventIds: string[],
 *     sealedSnapshots: { id, seq, sealedAt }[] }   — sealedSnapshots = snapshots that included this document or its events
 */
export type Erratum = { detachedAt: string; detachedBy: string | null; reason: string; withdrawnEventIds: string[]; sealedSnapshots: { id: string; seq: number; sealedAt: string }[] }

export async function detachDocument(ctx: Ctx, d: Doc, body: z.infer<typeof detachSchema>) {
  if (!(ATTACHED as readonly string[]).includes(d.attachState)) throw new HttpError(409, 'not_attached', 'Only an attached document can be detached')
  const at = new Date()
  const evs = await ctx.db.select({ id: events.id }).from(events).where(and(eq(events.documentId, d.id), isNull(events.withdrawnAt)))
  const ids = evs.map((e) => e.id)
  if (ids.length) await ctx.db.update(events).set({ withdrawnAt: at, withdrawnReason: 'document_detached', updatedAt: at }).where(inArray(events.id, ids))
  const allEventIds = (await ctx.db.select({ id: events.id }).from(events).where(eq(events.documentId, d.id))).map((e) => e.id)
  const snaps = await ctx.db.select({ id: snapshots.id, seq: snapshots.seq, sealedAt: snapshots.sealedAt, json: snapshots.canonicalJson }).from(snapshots)
    .where(eq(snapshots.patientId, d.patientId))
  const sealed = snaps.filter((s) => s.json.includes(d.id) || allEventIds.some((id) => s.json.includes(id)))
  const erratum: Erratum = {
    detachedAt: at.toISOString(), detachedBy: staffId(ctx.session), reason: body.reason, withdrawnEventIds: ids,
    sealedSnapshots: sealed.map((s) => ({ id: s.id, seq: s.seq, sealedAt: s.sealedAt.toISOString() })),
  }
  await ctx.db.update(documents).set({ attachState: 'detached', attachReason: body.reason, attachDecidedBy: staffId(ctx.session), attachDecidedAt: at, flags: { ...d.flags, erratum }, updatedAt: at })
    .where(eq(documents.id, d.id))
  await recomputeRadar(ctx.db, d.orgId, d.patientId)
  await ctx.audit('document.detach', 'document', d.id, { withdrawnEvents: ids.length, sealedSnapshots: sealed.map((s) => s.id) })
  return { ok: true, withdrawnEvents: ids.length, erratum: sealed.length > 0 }
}

// ── manual tags (FR-DOC-07, FR-EXT-07) ──────────────────────────────────────
export const tagsSchema = z.object({
  docType: z.enum(DOC_TYPES),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  institution: z.string().trim().max(200).nullable().optional(),
})

export async function tagDocument(ctx: Ctx, d: Doc, body: z.infer<typeof tagsSchema>) {
  if (d.status === 'quarantined') throw new HttpError(409, 'quarantined', 'A quarantined file cannot be tagged')
  const tags = new Set(d.manualTags)
  tags.add('doc_type')
  const set: Partial<typeof documents.$inferInsert> = { docType: body.docType, docTypeConfidence: 1, updatedAt: new Date() }
  if (body.documentDate !== undefined) {
    if (body.documentDate && parseDate(body.documentDate).iso !== body.documentDate) throw new HttpError(400, 'invalid_date', 'Invalid date')
    set.documentDate = body.documentDate
    tags.add('document_date')
  }
  if (body.institution !== undefined) {
    set.institutionName = body.institution || null
    tags.add('institution')
  }
  set.manualTags = [...tags]
  // A typed document is re-extracted with the staff class; an image-only (handwritten) one is complete once tagged.
  const rerun = !d.handwritten && d.docType !== body.docType && (ATTACHED as readonly string[]).includes(d.attachState)
  if (rerun) Object.assign(set, { status: 'queued', attempts: 0 })
  else if (d.handwritten && (ATTACHED as readonly string[]).includes(d.attachState) && d.status === 'needs_review') set.status = 'done'
  await ctx.db.update(documents).set(set).where(eq(documents.id, d.id))
  await ctx.audit('document.tags', 'document', d.id, { docType: body.docType, rerun })
  if (rerun) scheduleProcessing(d.id, d.orgId)
  else await recomputeRadar(ctx.db, d.orgId, d.patientId)
  return { ok: true, reprocessing: rerun }
}

// ── manual event, still gated (FR-EXT-07, V02-E2E-06) ───────────────────────
export const manualEventSchema = z.object({
  eventType: z.enum(EXTRACTABLE_EVENT_TYPES as [string, ...string[]]),
  fields: z.record(z.string(), z.union([z.string().max(300), z.number().int().min(0), z.array(z.string().max(300)).max(30)])),
  quote: z.string().min(1).max(300),
  pageNo: z.number().int().min(1),
})

export async function addManualEvent(ctx: Ctx, d: Doc, body: z.infer<typeof manualEventSchema>) {
  if (!(ATTACHED as readonly string[]).includes(d.attachState)) throw new HttpError(409, 'not_attached', 'Attach the document before adding facts')
  const [page] = await ctx.db.select().from(documentPages).where(and(eq(documentPages.documentId, d.id), eq(documentPages.pageNo, body.pageNo)))
  if (!page) throw new HttpError(404, 'page_not_found', 'No such page')
  // FR-DOC-07: image-only pages (handwritten) carry no machine text, so facts cannot be quoted — tags only.
  if (!page.text.trim()) throw new HttpError(422, 'image_only', 'This page is stored as an image only; add document tags instead')
  const pr: PageRead = {
    pageNo: page.pageNo, text: page.text, words: page.words ?? null, ocrConfidence: page.ocrConfidence, lowConfidence: page.lowConfidence,
    source: page.words ? 'ocr' : 'text_layer', handwriting: null, hidden: null, image: null, processor: page.processor ?? '', processorVersion: page.processorVersion ?? '',
  }
  const classified = { usable: [pr] } as Classified
  const docDate = d.documentDate ? parseDate(d.documentDate) : null
  const { gate, drafts } = gateAndDate([{ event_type: body.eventType, fields: body.fields, quote: body.quote, page_no: body.pageNo }], classified, { documentDate: docDate }, d.receivedAt, 'rules')
  if (!drafts.length) {
    const r = gate.rejected[0]
    await ctx.audit('document.manual_event_rejected', 'document', d.id, { reason: r?.reason ?? 'rejected' })
    throw new HttpError(422, r?.reason ?? 'rejected', r?.reason === 'quote_not_found' ? 'That quote is not on this page (copy it exactly)' : `Rejected by the evidence gate: ${r?.reason}${r?.detail ? ` (${r.detail})` : ''}`)
  }
  const draft = drafts[0]
  const flags: Record<string, boolean> = Object.fromEntries(Object.entries(draft.flags).filter(([k, v]) => v && k !== 'rule_based')) as Record<string, boolean>
  const [ev] = await ctx.db.insert(events).values({
    orgId: d.orgId, patientId: d.patientId, encounterId: d.encounterId, documentId: d.id, eventType: draft.eventType, fields: draft.fields,
    eventDate: draft.eventDate, datePrecision: draft.datePrecision, dateFlags: draft.dateFlags, documentDate: draft.documentDate, receivedAt: d.receivedAt,
    sourceType: 'external_document', extractionMethod: 'manual', flags, createdByKind: 'staff', createdById: staffId(ctx.session),
  }).returning({ id: events.id })
  await ctx.db.insert(evidence).values({
    orgId: d.orgId, patientId: d.patientId, eventId: ev.id, documentId: d.id, pageNo: draft.evidence.pageNo, charStart: draft.evidence.charStart,
    charEnd: draft.evidence.charEnd, quote: draft.evidence.quote, quoteSha256: draft.evidence.quoteSha256,
  })
  await recomputeRadar(ctx.db, d.orgId, d.patientId)
  await ctx.audit('document.manual_event', 'event', ev.id, { documentId: d.id, eventType: draft.eventType })
  return { ok: true, eventId: ev.id }
}

// ── reprocess / password ────────────────────────────────────────────────────
export async function reprocessDocument(ctx: Ctx, d: Doc) {
  if (d.status === 'quarantined') throw new HttpError(409, 'quarantined', 'A quarantined file is never processed')
  if (d.status === 'processing' && !needsRunner(d)) throw new HttpError(409, 'processing', 'Already processing')
  await ctx.db.update(documents).set({ status: 'queued', attempts: 0, lastError: null, lockedAt: null, updatedAt: new Date() }).where(eq(documents.id, d.id))
  await ctx.audit('document.reprocess', 'document', d.id)
  scheduleProcessing(d.id, d.orgId)
  return { ok: true, status: 'queued' }
}

export const passwordSchema = z.object({ password: z.string().min(1).max(128) })

/** FR-ING-07: the password is passed to one processing run in memory and never stored or logged. */
export async function submitPassword(ctx: Ctx, d: Doc, body: z.infer<typeof passwordSchema>) {
  if (!(d.status === 'unreadable' && d.flags.password_required)) throw new HttpError(409, 'no_password_needed', 'This document is not waiting for a password')
  await ctx.db.update(documents).set({ status: 'queued', attempts: 0, lockedAt: null, updatedAt: new Date() }).where(eq(documents.id, d.id))
  await ctx.audit('document.password_submitted', 'document', d.id)
  scheduleProcessing(d.id, d.orgId, { password: body.password })
  return { ok: true, status: 'queued' }
}

