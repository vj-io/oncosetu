// FR-VER-04: sampling QA of records-verified items. Second reviews live in verification_qa_reviews (append-only).
import { and, desc, eq } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents, events, staff, verifications } from '@/db/schema'
import { HttpError } from '../http'
import { assertPatientAccess } from '../patients'
import type { AdminCtx } from './ctx'
import { canSecondReview, disagreementRate, selectQaSample } from './qa-core'
import { verificationQaReviews } from './tables'

export type QaItem = {
  verificationId: string; eventId: string; patientId: string; documentId: string | null; eventType: string; docType: string | null
  verifierId: string; verifierName: string | null; verifiedAt: Date; week: string | null
  review: { outcome: 'agree' | 'disagree'; reviewerName: string | null; at: Date } | null
}

async function recordsVerified(tx: Tx) {
  return tx.select({
    id: verifications.id, at: verifications.at, eventId: verifications.eventId, patientId: verifications.patientId,
    verifierId: verifications.actorId, eventType: events.eventType, documentId: events.documentId, docType: documents.docType,
  }).from(verifications)
    .innerJoin(events, eq(events.id, verifications.eventId)).leftJoin(documents, eq(documents.id, events.documentId))
    .where(and(eq(verifications.role, 'records'), eq(verifications.action, 'verify'))).orderBy(desc(verifications.at))
}

export async function loadQa(tx: Tx) {
  const verified = await recordsVerified(tx)
  const sample = selectQaSample(verified)
  const reviews = await tx.select().from(verificationQaReviews)
  const names = new Map((await tx.select({ id: staff.id, name: staff.name }).from(staff)).map((s) => [s.id, s.name]))
  const weekOf = new Map(sample.map((s) => [s.id, s.week]))
  const reviewOf = new Map(reviews.map((r) => [r.verificationId, r]))
  const shown = verified.filter((v) => weekOf.has(v.id) || reviewOf.has(v.id)) // sample ∪ already reviewed
  const items: QaItem[] = shown.map((v) => {
    const r = reviewOf.get(v.id)
    return {
      verificationId: v.id, eventId: v.eventId, patientId: v.patientId, documentId: v.documentId, eventType: v.eventType, docType: v.docType,
      verifierId: v.verifierId, verifierName: names.get(v.verifierId) ?? null, verifiedAt: v.at, week: weekOf.get(v.id) ?? null,
      review: r ? { outcome: r.outcome, reviewerName: names.get(r.reviewerId) ?? null, at: r.reviewedAt } : null,
    }
  })
  return { eligible: verified.length, items, ...disagreementRate(reviews) }
}

export async function recordQaReview(ctx: AdminCtx, verificationId: string, outcome: 'agree' | 'disagree') {
  const verified = await recordsVerified(ctx.db)
  const v = verified.find((x) => x.id === verificationId)
  if (!v) throw new HttpError(404, 'not_found', 'Not found')
  if (!selectQaSample(verified).some((s) => s.id === verificationId)) throw new HttpError(400, 'not_sampled', 'This item is not in the QA sample')
  if (!canSecondReview(ctx.session.staffId, v.verifierId)) throw new HttpError(403, 'same_person', 'A second review must come from someone other than the verifier')
  await assertPatientAccess(ctx, v.patientId) // reviewing means opening the source: same consent / break-glass rule as everyone else
  const [existing] = await ctx.db.select({ id: verificationQaReviews.id }).from(verificationQaReviews).where(eq(verificationQaReviews.verificationId, verificationId))
  if (existing) throw new HttpError(409, 'already_reviewed', 'This item already has a second review')
  const [row] = await ctx.db.insert(verificationQaReviews).values({
    orgId: ctx.session.orgId, patientId: v.patientId, verificationId, eventId: v.eventId, reviewerId: ctx.session.staffId, outcome,
  }).returning({ id: verificationQaReviews.id })
  await ctx.audit('verification.qa_review', 'verification', verificationId, { outcome, eventId: v.eventId, reviewId: row.id })
  return { id: row.id }
}
