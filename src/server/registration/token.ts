// QR card token (FR-ID-01, FR-ID-08, E-ID-07). Only the HMAC is stored; the plain token is shown once, on the card.
import { and, eq, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { auditLog, patients } from '@/db/schema'
import { generateToken, isTokenShape, tokenHash } from './logic'
import type { AuditFn } from './http'

/**
 * Replaces the patient's token. The old hash moves into the (append-only) audit row, so the old card keeps
 * answering "revoked" rather than "unknown". Returns the new plain token: show it once, never store it.
 * Also used by the patient portal when the patient revokes their own card.
 */
export async function reissueToken(tx: Tx, audit: AuditFn, patientId: string, via: 'staff' | 'patient' = 'staff'): Promise<{ token: string } | null> {
  const [p] = await tx.select({ hash: patients.oncosetuTokenHash }).from(patients).where(eq(patients.id, patientId))
  if (!p) return null
  const token = generateToken()
  await tx.update(patients).set({ oncosetuTokenHash: tokenHash(token), tokenRevokedAt: null, updatedAt: new Date() }).where(eq(patients.id, patientId))
  await audit('patient.token_reissued', 'patient', patientId, { revokedTokenHash: p.hash, via })
  return { token }
}

/** Revoke without a replacement: the card stops working at once (old token answers "revoked"). */
export async function revokeToken(tx: Tx, audit: AuditFn, patientId: string, via: 'staff' | 'patient' = 'staff'): Promise<boolean> {
  const done = await tx.update(patients).set({ tokenRevokedAt: new Date(), updatedAt: new Date() })
    .where(eq(patients.id, patientId)).returning({ id: patients.id })
  if (!done.length) return false
  await audit('patient.token_revoked', 'patient', patientId, { via })
  return true
}

export type TokenLookup = { status: 'ok'; patientId: string } | { status: 'revoked' } | { status: 'not_found' }

/** Staff scan or typed token → patient id, scoped to the session's org (another org's card is "not found"). */
export async function resolveToken(tx: Tx, orgId: string, raw: string): Promise<TokenLookup> {
  if (!isTokenShape(raw)) return { status: 'not_found' }
  const h = tokenHash(raw)
  const rows = await tx.execute<{ patient_id: string; org_id: string; token_revoked: boolean }>(
    sql`select * from resolve_patient_by_token(${h})`)
  const r = rows[0]
  if (r) {
    if (r.org_id !== orgId) return { status: 'not_found' }
    return r.token_revoked ? { status: 'revoked' } : { status: 'ok', patientId: r.patient_id }
  }
  const [old] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(
    eq(auditLog.orgId, orgId), eq(auditLog.action, 'patient.token_reissued'), sql`${auditLog.details}->>'revokedTokenHash' = ${h}`,
  )).limit(1)
  return old ? { status: 'revoked' } : { status: 'not_found' }
}
