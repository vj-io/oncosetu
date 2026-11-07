// Share links (FR-PAS-01..04, J5): payload from the latest sealed snapshot, create, open (public), revoke, staff list.
// The server stores and returns only ciphertext + iv: the AES key lives in the URL fragment and never reaches it.
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import { SHARE_SIG_CONTEXT, type ShareSig } from '@/components/shares/crypto'
import { canonicalJson } from '@/core/canonical'
import type { Snapshot } from '@/core/ledger'
import { brandFor } from '@/core/copy'
import { db, withOrg, type Tx } from '@/db'
import { evidence, missingRecords, patients, shareLinks, shareViews, snapshots, verifications } from '@/db/schema'
import { ts } from '@/i18n/shares'
import { writeAudit, type AuditDetails } from '../audit'
import { now } from '../clock'
import { hashPassword, hmac, sha256Hex, signEd25519, verifyEd25519, verifyPassword } from '../crypto'
import { HttpError } from '../http'
import { sendMessage } from '../outbox'
import { activeConsent, assertConsent, assertPatientAccess } from '../patients'
import { deviceOf } from '../portal/access'
import { loadShares, revokeShare, type ShareRow } from '../portal/shares'
import { describeRows } from '../radar-ui/completeness'
import type { L2 } from '../radar-ui/wording'
import { primaryContactTarget } from '../registration/contact'
import type { Session } from '../session'
import { afterWrong, openGate } from './gate'
import { buildSharePayload, QuotesNotAllowed, type SharePayload, type ShareScope } from './payload'

type Ctx = {
  db: Tx; session: Session
  audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}

/** API scope names ↔ the share_scope enum (summary = document index; summary_with_documents = index + source quotes). */
const SCOPE_DB = { index: 'summary', index_with_quotes: 'summary_with_documents' } as const
const SCOPE_API = { summary: 'index', summary_with_documents: 'index_with_quotes' } as const

async function latestSnapshot(tx: Tx, patientId: string) {
  const [s] = await tx.select().from(snapshots).where(eq(snapshots.patientId, patientId)).orderBy(desc(snapshots.seq)).limit(1)
  return s ?? null
}

/** Source quotes are clinical content: among staff only records officers and clinicians may share them (PRD §6.1). */
function assertScopeAllowed(session: Session, scope: ShareScope) {
  if (scope === 'index_with_quotes' && session.kind === 'staff' && session.role !== 'records' && session.role !== 'clinician') {
    throw new HttpError(403, 'quotes_not_allowed', 'Only records officers and clinicians can share source quotes')
  }
}

export type SignedSharePayload = SharePayload & { snapshotId: string; issuedAt: string; sig: ShareSig }

/**
 * Payload for the latest SEALED snapshot (or `snapshotId`, one of this patient's: the printable passport), signed with the
 * sealing key (S2c: the viewer trusts nothing a creator could have edited). 409 no_snapshot; 403 quotes_not_allowed unless
 * disclosure is cleared (and, for staff, records/clinician).
 */
export async function sharePayloadFor(tx: Tx, patientId: string, scope: ShareScope, session: Session, snapshotId?: string): Promise<SignedSharePayload> {
  assertScopeAllowed(session, scope)
  const [p] = await tx.select({ disclosure: patients.disclosureStatus }).from(patients).where(eq(patients.id, patientId))
  if (!p) throw new HttpError(404, 'not_found', 'Not found')
  const snap = snapshotId
    ? (await tx.select().from(snapshots).where(and(eq(snapshots.id, snapshotId), eq(snapshots.patientId, patientId))))[0] ?? null
    : await latestSnapshot(tx, patientId)
  if (!snap) throw new HttpError(409, 'no_snapshot', 'There is no sealed record to share yet')
  const snapshot = JSON.parse(snap.canonicalJson) as Snapshot

  const verifiedIds = snapshot.verified.map((e) => e.id)
  const vers = verifiedIds.length ? await tx.select({ eventId: verifications.eventId, role: verifications.role }).from(verifications).where(and(
    inArray(verifications.eventId, verifiedIds), inArray(verifications.toStatus, ['verified_matches_source', 'edited']),
    lte(verifications.at, snap.sealedAt),
  )).orderBy(asc(verifications.at)) : []
  const verifiers: Record<string, 'records' | 'clinician'> = {}
  for (const v of vers) verifiers[v.eventId] = v.role === 'clinician' ? 'clinician' : 'records' // latest wins

  const quotes: Record<string, string> = {}
  const allIds = [...verifiedIds, ...snapshot.unverified.map((e) => e.id)]
  if (scope === 'index_with_quotes' && p.disclosure === 'cleared' && allIds.length) {
    const rows = await tx.select({ eventId: evidence.eventId, quote: evidence.quote }).from(evidence)
      .where(inArray(evidence.eventId, allIds)).orderBy(asc(evidence.createdAt), asc(evidence.id))
    for (const r of rows) if (r.quote && !quotes[r.eventId]) quotes[r.eventId] = r.quote
  }

  const keys = snapshot.missing.map((m) => m.dedupeKey)
  const absentNeutral: Record<string, L2> = {}
  if (keys.length) {
    const rows = await tx.select().from(missingRecords).where(and(eq(missingRecords.patientId, patientId), inArray(missingRecords.dedupeKey, keys)))
    for (const d of await describeRows(tx, rows)) absentNeutral[d.dedupeKey] = d.neutral
  }
  try {
    const payload = buildSharePayload({ snapshot, snapshotId: snap.id, sha256: snap.sha256, disclosure: p.disclosure, scope, verifiers, quotes, absentNeutral })
    return signSharePayload({ ...payload, snapshotId: snap.id, issuedAt: (await now(session.orgId)).toISOString() })
  } catch (e) {
    if (e instanceof QuotesNotAllowed) throw new HttpError(403, 'quotes_not_allowed', 'Source quotes can be shared only when disclosure is cleared')
    throw e
  }
}

/** Signs everything but `sig`: SHARE_SIG_CONTEXT + sha256hex(canonical JSON), checked by verifySharePayload in the viewer. */
export const signSharePayload = <T extends object>(body: T): T & { sig: ShareSig } =>
  ({ ...body, sig: signEd25519(Buffer.from(SHARE_SIG_CONTEXT + sha256Hex(canonicalJson(body)), 'utf8')) })

/** Fallback for browsers without WebCrypto Ed25519: checks a signature over a payload DIGEST (the record never comes here). */
export const shareDigestValid = (digest: string, sig: ShareSig) =>
  verifyEd25519(Buffer.from(SHARE_SIG_CONTEXT + digest, 'utf8'), sig.signature, sig.keyId)

export type CreateShareInput = {
  patientId?: string; snapshotId: string; ciphertext: string; iv: string; scope: ShareScope; expiresInDays: number; passcode: string | null
}

export async function createShare(ctx: Ctx, input: CreateShareInput): Promise<{ id: string; expiresAt: string }> {
  const patientId = ctx.session.kind === 'staff' ? input.patientId : ctx.session.patientId
  if (!patientId) throw new HttpError(400, 'patient_required', 'Choose a patient')
  assertScopeAllowed(ctx.session, input.scope)
  await assertPatientAccess(ctx, patientId)
  await assertConsent(ctx.db, patientId, 'share') // checked on use (FR-CON-04)
  const [p] = await ctx.db.select({ disclosure: patients.disclosureStatus }).from(patients).where(eq(patients.id, patientId))
  if (input.scope === 'index_with_quotes' && p?.disclosure !== 'cleared') throw new HttpError(403, 'quotes_not_allowed', 'Source quotes can be shared only when disclosure is cleared')
  const snap = await latestSnapshot(ctx.db, patientId)
  if (!snap) throw new HttpError(409, 'no_snapshot', 'There is no sealed record to share yet')
  if (snap.id !== input.snapshotId) throw new HttpError(409, 'stale_snapshot', 'A newer sealed record exists. Please create the link again.')
  const at = await now(ctx.session.orgId)
  const expiresAt = new Date(+at + input.expiresInDays * 86_400_000)
  const by = ctx.session.kind === 'staff' ? { kind: 'staff' as const, id: ctx.session.staffId } : { kind: ctx.session.kind, id: ctx.session.caregiverId ?? ctx.session.patientId }
  const [row] = await ctx.db.insert(shareLinks).values({
    orgId: ctx.session.orgId, patientId, snapshotId: snap.id, scope: SCOPE_DB[input.scope], ciphertext: input.ciphertext, iv: input.iv,
    expiresAt, passcodeHash: input.passcode ? await hashPassword(input.passcode) : null, createdByKind: by.kind, createdById: by.id,
  }).returning({ id: shareLinks.id })
  await ctx.audit('share.create', 'share_link', row.id, {
    patientId, snapshotId: snap.id, scope: input.scope, days: input.expiresInDays, passcode: !!input.passcode,
  })
  return { id: row.id, expiresAt: expiresAt.toISOString() }
}

/** Staff of the org (with access to the patient) or that patient/caregiver. Unknown/foreign ids → uniform 404. */
export async function revokeShareFor(ctx: Ctx, id: string): Promise<{ ok: true }> {
  const [link] = await ctx.db.select({ patientId: shareLinks.patientId }).from(shareLinks).where(eq(shareLinks.id, id))
  if (!link) throw new HttpError(404, 'not_found', 'Not found')
  await assertPatientAccess(ctx, link.patientId)
  await revokeShare(ctx.db, ctx.session.orgId, link.patientId, id)
  await ctx.audit('share.revoke', 'share_link', id, { patientId: link.patientId })
  return { ok: true }
}

export type StaffShareRow = ShareRow & { passcode: boolean; createdBy: string; views: { at: string; outcome: string; device: string }[] }

export async function listSharesForStaff(tx: Tx, orgId: string, patientId: string): Promise<StaffShareRow[]> {
  const base = await loadShares(tx, orgId, patientId)
  if (!base.length) return []
  const meta = await tx.select({ id: shareLinks.id, passcodeHash: shareLinks.passcodeHash, by: shareLinks.createdByKind }).from(shareLinks)
    .where(inArray(shareLinks.id, base.map((b) => b.id)))
  const views = await tx.select({ link: shareViews.shareLinkId, at: shareViews.at, outcome: shareViews.outcome, ua: shareViews.userAgent }).from(shareViews)
    .where(eq(shareViews.patientId, patientId)).orderBy(desc(shareViews.at)).limit(500)
  const m = new Map(meta.map((x) => [x.id, x]))
  return base.map((b) => ({
    ...b, passcode: !!m.get(b.id)?.passcodeHash, createdBy: m.get(b.id)?.by ?? 'staff',
    views: views.filter((v) => v.link === b.id).slice(0, 30).map((v) => ({ at: v.at.toISOString(), outcome: v.outcome, device: deviceOf(v.ua) })),
  }))
}

// ── public open ──────────────────────────────────────────────────────────────

export type OpenResult =
  | { status: 200; body: { ciphertext: string; iv: string; scope: ShareScope; expiresAt: string } }
  | { status: 401 | 404 | 410 | 423; body: { error: { code: string; message: string }; attemptsLeft?: number } }

const err = (status: 401 | 404 | 410 | 423, code: string, message: string, extra: { attemptsLeft?: number } = {}): OpenResult =>
  ({ status, body: { error: { code, message }, ...extra } })

/**
 * POST /api/shares/[id]/open. Expiry, revocation and consent are checked on use (410, neutral message); 5 wrong
 * passcodes lock the link (423) and notify the primary contact once (E-PAS-02). Every outcome except "passcode
 * required" is logged in share_views (time, HMAC of IP, user agent) for the patient's access log (FR-PAS-04).
 */
export async function openShare(id: string, passcode: string | undefined, meta: { ip: string; userAgent: string }): Promise<OpenResult> {
  const found = await db.execute<{ share_id: string; patient_id: string; org_id: string }>(sql`select * from resolve_share(${id}::uuid)`)
  const ref = found[0]
  if (!ref) return err(404, 'not_found', 'This link was not found')
  return withOrg(ref.org_id, async (tx) => {
    const [link] = await tx.select().from(shareLinks).where(eq(shareLinks.id, id))
    const [p] = await tx.select({ status: patients.status, disclosure: patients.disclosureStatus }).from(patients).where(eq(patients.id, ref.patient_id))
    if (!link || !p) return err(404, 'not_found', 'This link was not found')
    const at = await now(ref.org_id)
    const available = p.status === 'active' && !!(await activeConsent(tx, ref.patient_id))?.purposes.share
    const log = (outcome: string) => tx.insert(shareViews).values({
      orgId: ref.org_id, patientId: ref.patient_id, shareLinkId: id, ipHash: hmac(meta.ip || 'unknown'), userAgent: meta.userAgent.slice(0, 300) || null, outcome,
    })
    const gate = openGate({ ...link, hasPasscode: !!link.passcodeHash }, at, available, !!passcode)
    const gone = 'This link is no longer available'
    switch (gate) {
      case 'gone_revoked': await log('revoked'); return err(410, 'gone', gone)
      case 'gone_expired': await log('expired'); return err(410, 'gone', gone)
      case 'gone_unavailable': await log('unavailable'); return err(410, 'gone', gone)
      case 'locked': await log('locked'); return err(423, 'locked', 'This link is locked')
      case 'passcode_required': return err(401, 'passcode_required', 'Enter the passcode')
      case 'check_passcode':
        if (!(await verifyPassword(passcode!, link.passcodeHash!))) {
          const [u] = await tx.update(shareLinks).set({ attempts: sql`${shareLinks.attempts} + 1` }).where(eq(shareLinks.id, id)).returning({ attempts: shareLinks.attempts })
          const r = afterWrong(u.attempts)
          if (!r.locked) { await log('wrong_passcode'); return err(401, 'wrong_passcode', 'The passcode did not match', { attemptsLeft: r.left }) }
          const won = await tx.update(shareLinks).set({ lockedAt: at }).where(and(eq(shareLinks.id, id), isNull(shareLinks.lockedAt))).returning({ id: shareLinks.id })
          if (won.length) {
            const to = await primaryContactTarget(tx, ref.patient_id)
            if (to) {
              await sendMessage(tx, {
                orgId: ref.org_id, patientId: ref.patient_id, toPhone: to.phone, channel: 'sms', templateKey: 'share.locked', lang: to.lang,
                body: ts(to.lang, 'lockedSms', { brand: brandFor(p.disclosure) }),
              })
            }
            await writeAudit(tx, { orgId: ref.org_id, actorId: null, actorRole: 'system', action: 'share.locked', targetType: 'share_link', targetId: id, details: { patientId: ref.patient_id, notified: !!to } })
          }
          await log('locked')
          return err(423, 'locked', 'This link is locked')
        }
        break
      case 'open': break
    }
    await log('viewed')
    return { status: 200 as const, body: { ciphertext: link.ciphertext, iv: link.iv, scope: SCOPE_API[link.scope], expiresAt: link.expiresAt.toISOString() } }
  })
}
