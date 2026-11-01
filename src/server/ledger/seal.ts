// Sealing snapshots and verifying them publicly (FR-LED-01, FR-ONB-03, V03-E2E-07).
import { and, desc, eq, isNull, max, sql } from 'drizzle-orm'
import { db, withOrg } from '@/db'
import { encounters, organisations, snapshots } from '@/db/schema'
import { buildSnapshot, canonicalJson, type Snapshot } from '@/core/ledger'
import { now } from '../clock'
import { sha256Hex, signEd25519, verifyEd25519 } from '../crypto'
import { HttpError, type RouteCtx } from '../http'
import { assertPatientAccess } from '../patients'
import { assembleRecord } from './core'
import { loadRecordRows } from './record'

/** Canonical JSON → SHA-256 + Ed25519 signature over the same UTF-8 bytes. */
export function sealBytes(snapshot: Snapshot) {
  const json = canonicalJson(snapshot)
  return { json, sha256: sha256Hex(json), ...signEd25519(Buffer.from(json, 'utf8')) }
}

/** POST /api/patients/[id]/seal (clinician). Partial verification is allowed; unverified items are labelled (FR-ONB-03). */
export async function sealSnapshot(ctx: RouteCtx<'staff', undefined, undefined>, patientId: string) {
  await assertPatientAccess(ctx, patientId)
  const at = await now(ctx.session.orgId)
  const { record } = assembleRecord(await loadRecordRows(ctx.db, patientId))
  const snapshot = buildSnapshot(record, at.toISOString())
  if (!snapshot.verified.length && !snapshot.unverified.length && !snapshot.documents.length) {
    throw new HttpError(409, 'nothing_to_seal', 'The record is empty: nothing to seal yet.')
  }
  const { json, sha256, signature, keyId } = sealBytes(snapshot)
  // Serialise seals per patient so seq is gap-free and unique (the unique constraint is the backstop).
  await ctx.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'seal:' + patientId}, 0))`)
  const [{ last }] = await ctx.db.select({ last: max(snapshots.seq) }).from(snapshots).where(eq(snapshots.patientId, patientId))
  const [enc] = await ctx.db.select({ id: encounters.id }).from(encounters)
    .where(and(eq(encounters.patientId, patientId), isNull(encounters.closedAt))).orderBy(desc(encounters.startedAt)).limit(1)
  const seq = (last ?? -1) + 1
  const [row] = await ctx.db.insert(snapshots).values({
    orgId: ctx.session.orgId, patientId, encounterId: enc?.id ?? null, seq, canonicalJson: json, sha256, signature, keyId,
    signerId: ctx.session.staffId, sealedAt: at,
  }).returning({ id: snapshots.id })
  if (enc) await ctx.db.update(encounters).set({ sealedSnapshotId: row.id }).where(eq(encounters.id, enc.id))
  const counts = { verified: snapshot.verified.length, unverified: snapshot.unverified.length, documents: snapshot.documents.length, missing: snapshot.missing.length }
  await ctx.audit('snapshot.seal', 'snapshot', row.id, { patientId, seq, sha256, keyId, ...counts, ...(enc ? { encounterId: enc.id } : {}) })
  return { snapshotId: row.id, seq, sha256, signature, keyId, sealedAt: at.toISOString(), counts }
}

export type SnapshotVerdict = {
  snapshotId: string; seq: number; sha256Recomputed: string; sha256Stored: string; hashMatches: boolean; signatureValid: boolean
  keyId: string | null; sealedAt: string
  counts: { verified: number; unverified: number; documents: number; missing: number; statements: number } | null
}

/** Pure: recompute the hash of the stored canonical bytes and check the signature over them. No PHI in the result. */
export function checkSnapshot(row: Pick<typeof snapshots.$inferSelect, 'id' | 'seq' | 'canonicalJson' | 'sha256' | 'signature' | 'keyId' | 'sealedAt'>): SnapshotVerdict {
  const recomputed = sha256Hex(row.canonicalJson)
  const signatureValid = !!row.signature && !!row.keyId && verifyEd25519(Buffer.from(row.canonicalJson, 'utf8'), row.signature, row.keyId)
  let counts: SnapshotVerdict['counts'] = null
  try {
    const s = JSON.parse(row.canonicalJson) as Snapshot
    counts = { verified: s.verified.length, unverified: s.unverified.length, documents: s.documents.length, missing: s.missing.length, statements: s.statements.length }
  } catch { /* tampered beyond JSON: counts unknown */ }
  return {
    snapshotId: row.id, seq: row.seq, sha256Recomputed: recomputed, sha256Stored: row.sha256, hashMatches: recomputed === row.sha256,
    signatureValid, keyId: row.keyId, sealedAt: row.sealedAt.toISOString(), counts,
  }
}

/**
 * Public lookup by snapshot id. The org is unknown to an anonymous caller, so try each org under RLS (no owner role).
 */
// ponytail: one query per org; add a SECURITY DEFINER resolve_snapshot(id) → org_id when there are more than a few orgs.
export async function verifySnapshotPublic(snapshotId: string): Promise<SnapshotVerdict | null> {
  const orgs = await db.select({ id: organisations.id }).from(organisations)
  for (const o of orgs) {
    const [row] = await withOrg(o.id, (tx) => tx.select().from(snapshots).where(eq(snapshots.id, snapshotId)))
    if (row) return checkSnapshot(row)
  }
  return null
}
