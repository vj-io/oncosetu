// Consent rows (append-only) and withdrawal (FR-CON-04, J8).
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Tx } from '@/db'
import { consents, shareLinks, type ConsentPurposes } from '@/db/schema'
import { cancelOpenErasure } from '../erasure/erasure'
import { HttpError } from '../http'
import { activeConsent, assertPatientAccess } from '../patients'
import { confirmAction, confirmPurpose } from './confirm'
import { primaryContactTarget } from './contact'
import { checkGrantPurposes, NO_PURPOSES } from './logic'
import { fail, type AuditFn, type StaffCtx } from './http'
import { confirmSchema, consentInput } from './schemas'

export type ConsentRowInput = {
  orgId: string; patientId: string; action: 'grant' | 'update' | 'withdraw'; purposes: ConsentPurposes
  actorType: 'staff' | 'patient' | 'caregiver'; actorId: string; method: 'self' | 'desk_assisted'; witnessedBy?: string
  noticeVersion: string; language: string
}

export async function insertConsent(tx: Tx, c: ConsentRowInput): Promise<string> {
  const [row] = await tx.insert(consents).values({
    orgId: c.orgId, patientId: c.patientId, action: c.action, purposes: c.purposes, actorType: c.actorType, actorId: c.actorId,
    method: c.method, witnessedBy: c.witnessedBy ?? null, noticeVersion: c.noticeVersion, language: c.language,
  }).returning({ id: consents.id })
  return row.id
}

/**
 * Withdrawal on the patient's request: one append-only row, effective on the next request because consent is
 * checked on use. Active share links for the patient are revoked at the same time.
 */
export async function withdrawConsent(tx: Tx, audit: AuditFn, p: { orgId: string; patientId: string; staffId: string }): Promise<{ consentId: string; revokedShareLinks: number } | null> {
  const current = await activeConsent(tx, p.patientId)
  if (!current) return null
  const consentId = await insertConsent(tx, {
    orgId: p.orgId, patientId: p.patientId, action: 'withdraw', purposes: NO_PURPOSES, actorType: 'staff', actorId: p.staffId,
    method: 'desk_assisted', witnessedBy: p.staffId, noticeVersion: current.noticeVersion, language: current.language,
  })
  const revoked = await tx.update(shareLinks).set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.patientId, p.patientId), isNull(shareLinks.revokedAt))).returning({ id: shareLinks.id })
  await audit('consent.withdrawn', 'patient', p.patientId, { consentId, method: 'desk_assisted', revokedShareLinks: revoked.length })
  return { consentId, revokedShareLinks: revoked.length }
}

export const recordConsentSchema = consentInput.extend({ confirm: confirmSchema })

/**
 * New consent from the Consent tab (first grant, change of purposes, or re-consent after a withdrawal).
 * Confirmed by a code to the primary contact or in person with a witness (FR-CON-06).
 */
export async function recordConsent(ctx: StaffCtx<z.infer<typeof recordConsentSchema>>, patientId: string) {
  // No consent may exist yet (or it was withdrawn): a verified visit in the last 12 h stands in; the desk always needs one.
  await assertPatientAccess(ctx, patientId, { consentOptional: true })
  const { session: s, body, db: tx } = ctx
  const g = checkGrantPurposes(body.purposes)
  if (!g.ok) throw new HttpError(400, g.code, 'Keeping and organising the record is required. To stop, withdraw consent instead.')
  const target = await primaryContactTarget(tx, patientId)
  const c = await confirmAction(target, confirmPurpose(patientId), body.confirm)
  if (!c.ok) return c.response
  const current = await activeConsent(tx, patientId)
  const viaOtp = c.method === 'otp'
  const consentId = await insertConsent(tx, {
    orgId: s.orgId, patientId, action: current ? 'update' : 'grant', purposes: body.purposes, noticeVersion: body.noticeVersion, language: body.language,
    ...(viaOtp
      ? { actorType: target?.caregiverId ? 'caregiver' as const : 'patient' as const, actorId: target?.caregiverId ?? patientId, method: 'self' as const }
      : { actorType: 'staff' as const, actorId: s.staffId, method: 'desk_assisted' as const, witnessedBy: s.staffId }),
  })
  await ctx.audit('consent.recorded', 'patient', patientId, {
    consentId, action: current ? 'update' : 'grant', noticeVersion: body.noticeVersion, language: body.language, method: c.method,
    ai: body.purposes.ai, share: body.purposes.share, abdm: body.purposes.abdm, metrics: body.purposes.metrics,
  })
  if (body.purposes.store) { // J8: consent restored, so an erasure request that was waiting is cancelled
    for (const id of await cancelOpenErasure(tx, patientId)) await ctx.audit('erasure.cancel', 'erasure_request', id, { patientId, reason: 'consent_restored' })
  }
  return { ok: true, consentId }
}

export async function withdrawConsentRoute(ctx: StaffCtx<unknown>, patientId: string) {
  await assertPatientAccess(ctx, patientId, { consentOptional: true }) // no consent left → the 409 below, not a 403
  const r = await withdrawConsent(ctx.db, ctx.audit, { orgId: ctx.session.orgId, patientId, staffId: ctx.session.staffId })
  return r ? { ok: true, ...r } : fail(409, 'no_active_consent', 'There is no active consent to withdraw')
}
