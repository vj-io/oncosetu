// E-ID-06 / V06-E2E-05: duplicate patients. Detection never shows names (initials + accession only); a merge needs
// two different staff members: the requester, then an approver, and executes in one transaction.
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { documents, events, patientAliases, patientMerges, patients, staff } from '@/db/schema'
import { decryptField, normalise } from '../crypto'
import { HttpError } from '../http'
import { initials } from '../patients'
import { identityKey } from '../registration/logic'
import type { AdminCtx } from './ctx'
import { checkMergeApproval, findDuplicatePairs, type DupPair, type DupPatient } from './duplicates-core'
import { accession } from './format'

export type DupView = { id: string; accession: string; initials: string; mrn: string | null; createdAt: Date; documents: number; events: number }
export type DupCandidate = Omit<DupPair, 'a' | 'b'> & { a: DupView; b: DupView; suggestedSurvivor: string }
export type MergeView = {
  id: string; state: string; survivor: string; duplicate: string; survivorId: string; duplicateId: string
  requestedBy: string; requestedById: string; approvedBy: string | null; reason: string | null; createdAt: Date; executedAt: Date | null
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export async function listMerges(tx: Tx, orgId: string): Promise<MergeView[]> {
  const rows = await tx.select().from(patientMerges).where(eq(patientMerges.orgId, orgId)).orderBy(desc(patientMerges.createdAt)).limit(50)
  const names = new Map((await tx.select({ id: staff.id, name: staff.name }).from(staff).where(eq(staff.orgId, orgId))).map((s) => [s.id, s.name]))
  return rows.map((m) => ({
    id: m.id, state: m.state, survivorId: m.survivorId, duplicateId: m.duplicateId, survivor: accession(m.survivorId), duplicate: accession(m.duplicateId),
    requestedBy: names.get(m.requestedBy) ?? '—', requestedById: m.requestedBy, approvedBy: m.approvedBy ? (names.get(m.approvedBy) ?? '—') : null,
    reason: m.reason, createdAt: m.createdAt, executedAt: m.executedAt,
  }))
}

// ponytail: decrypts every active patient to compare names, O(n) decrypts and O(k²) per same-DOB group; index a phonetic key past ~10k patients.
export async function listDuplicates(tx: Tx, orgId: string, merges: MergeView[]): Promise<DupCandidate[]> {
  const rows = await tx.select().from(patients).where(and(eq(patients.orgId, orgId), eq(patients.status, 'active')))
  const aliasBy = new Map<string, string[]>()
  for (const a of await tx.select({ patientId: patientAliases.patientId, nameEnc: patientAliases.nameEnc }).from(patientAliases).where(eq(patientAliases.orgId, orgId))) {
    aliasBy.set(a.patientId, [...(aliasBy.get(a.patientId) ?? []), decryptField(a.nameEnc)])
  }
  const names = new Map<string, string>()
  const dp: DupPatient[] = rows.map((r) => {
    const name = decryptField(r.nameEnc)
    const dob = r.dobEnc ? decryptField(r.dobEnc) : null
    names.set(r.id, name)
    return {
      id: r.id, status: r.status, name, aliases: aliasBy.get(r.id) ?? [], dob, phoneHmac: r.phoneHmac, abhaHmac: r.abhaHmac,
      identityHmac: r.identityHmac ?? identityKey(name, dob), mrn: r.mrn,
    }
  })
  const pairs = findDuplicatePairs(dp, new Set(merges.filter((m) => m.state !== 'rejected').map((m) => pairKey(m.survivorId, m.duplicateId))))
  const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))]
  if (!ids.length) return []
  const [docs, evs] = await Promise.all([
    tx.select({ id: documents.patientId, n: count() }).from(documents).where(inArray(documents.patientId, ids)).groupBy(documents.patientId),
    tx.select({ id: events.patientId, n: count() }).from(events).where(inArray(events.patientId, ids)).groupBy(events.patientId),
  ])
  const byId = new Map(rows.map((r) => [r.id, r]))
  const view = (id: string): DupView => {
    const r = byId.get(id)!
    return { id, accession: accession(id), initials: initials(names.get(id)!), mrn: r.mrn, createdAt: r.createdAt,
      documents: docs.find((d) => d.id === id)?.n ?? 0, events: evs.find((e) => e.id === id)?.n ?? 0 }
  }
  return pairs.map((p) => {
    const [a, b] = [view(p.a), view(p.b)]
    return { reasons: p.reasons, confidence: p.confidence, a, b, suggestedSurvivor: a.createdAt <= b.createdAt ? a.id : b.id }
  })
}

export async function requestMerge(ctx: AdminCtx, input: { survivorId: string; duplicateId: string; reason?: string }) {
  const { survivorId, duplicateId } = input
  if (survivorId === duplicateId) throw new HttpError(400, 'invalid_request', 'Choose two different records')
  const found = await ctx.db.select({ id: patients.id, status: patients.status }).from(patients)
    .where(and(eq(patients.orgId, ctx.session.orgId), inArray(patients.id, [survivorId, duplicateId])))
  if (found.length !== 2) throw new HttpError(404, 'not_found', 'Not found')
  if (found.some((p) => p.status !== 'active')) throw new HttpError(409, 'not_active', 'Only active records can be merged')
  const open = await ctx.db.select({ id: patientMerges.id }).from(patientMerges).where(and(
    eq(patientMerges.state, 'requested'), sql`(${patientMerges.survivorId} in (${survivorId}, ${duplicateId}) or ${patientMerges.duplicateId} in (${survivorId}, ${duplicateId}))`,
  ))
  if (open.length) throw new HttpError(409, 'merge_pending', 'One of these records already has a pending merge')
  const [m] = await ctx.db.insert(patientMerges).values({
    orgId: ctx.session.orgId, survivorId, duplicateId, requestedBy: ctx.session.staffId, reason: input.reason?.trim() || null,
  }).returning({ id: patientMerges.id })
  await ctx.audit('patient.merge_request', 'patient_merge', m.id, { survivorId, duplicateId })
  return { id: m.id }
}

export async function rejectMerge(ctx: AdminCtx, mergeId: string) {
  const [m] = await ctx.db.select().from(patientMerges).where(and(eq(patientMerges.id, mergeId), eq(patientMerges.orgId, ctx.session.orgId))).for('update')
  if (!m) throw new HttpError(404, 'not_found', 'Not found')
  if (m.state !== 'requested') throw new HttpError(409, 'not_pending', 'This merge is no longer pending')
  await ctx.db.update(patientMerges).set({ state: 'rejected' }).where(eq(patientMerges.id, mergeId))
  await ctx.audit('patient.merge_reject', 'patient_merge', mergeId)
}

/** Tables that follow the person. consents, verifications and snapshots are append-only at the DB level, so they stay (linked by the merge row). */
const MOVE = [
  'patient_aliases', 'caregivers', 'encounters', 'documents', 'document_files', 'document_pages', 'events', 'evidence',
  'patient_statements', 'missing_records', 'record_requests', 'share_links', 'share_views', 'ai_runs', 'outbox', 'break_glass',
] as const

/** Second approval, then execute. The requester cannot approve their own request. */
export async function approveMerge(ctx: AdminCtx, mergeId: string) {
  const orgId = ctx.session.orgId
  const [m] = await ctx.db.select().from(patientMerges).where(and(eq(patientMerges.id, mergeId), eq(patientMerges.orgId, orgId))).for('update')
  if (!m) throw new HttpError(404, 'not_found', 'Not found')
  const check = checkMergeApproval(m, ctx.session.staffId)
  if (!check.ok) {
    throw check.code === 'same_person'
      ? new HttpError(403, 'same_person', 'A merge needs approval from a second staff member, not the requester')
      : new HttpError(409, 'not_pending', 'This merge is no longer pending')
  }
  const pair = await ctx.db.select().from(patients).where(and(eq(patients.orgId, orgId), inArray(patients.id, [m.survivorId, m.duplicateId])))
  const survivor = pair.find((p) => p.id === m.survivorId), dup = pair.find((p) => p.id === m.duplicateId)
  if (!survivor || !dup || survivor.status !== 'active' || dup.status !== 'active') throw new HttpError(409, 'not_active', 'Only active records can be merged')

  await ctx.audit('patient.merge_approve', 'patient_merge', mergeId, { survivorId: m.survivorId, duplicateId: m.duplicateId, requestedBy: m.requestedBy })
  const moved: Record<string, number> = {}
  for (const t of MOVE) {
    const r = await ctx.db.execute(sql`update ${sql.identifier(t)} set patient_id = ${m.survivorId} where patient_id = ${m.duplicateId} and org_id = ${orgId}`)
    moved[t] = r.count
  }
  // The duplicate's name stays findable as an alias, and identifiers the survivor lacks carry over.
  if (normalise(decryptField(dup.nameEnc)) !== normalise(decryptField(survivor.nameEnc))) {
    await ctx.db.insert(patientAliases).values({ orgId, patientId: m.survivorId, nameEnc: dup.nameEnc, nameHmac: null, kind: 'other', createdBy: ctx.session.staffId })
  }
  await ctx.db.update(patients).set({
    abhaNumberEnc: survivor.abhaNumberEnc ?? dup.abhaNumberEnc, abhaHmac: survivor.abhaHmac ?? dup.abhaHmac,
    abhaVerified: survivor.abhaNumberEnc ? survivor.abhaVerified : dup.abhaVerified,
    phoneEnc: survivor.phoneEnc ?? dup.phoneEnc, phoneHmac: survivor.phoneHmac ?? dup.phoneHmac,
    dobEnc: survivor.dobEnc ?? dup.dobEnc, updatedAt: new Date(),
  }).where(eq(patients.id, m.survivorId))
  await ctx.db.update(patients).set({ status: 'merged', tokenRevokedAt: dup.tokenRevokedAt ?? new Date(), updatedAt: new Date() }).where(eq(patients.id, m.duplicateId))
  await ctx.db.update(patientMerges).set({ state: 'executed', approvedBy: ctx.session.staffId, executedAt: new Date() }).where(eq(patientMerges.id, mergeId))
  await ctx.audit('patient.merge_execute', 'patient_merge', mergeId, {
    survivorId: m.survivorId, duplicateId: m.duplicateId, documents: moved.documents, events: moved.events, evidence: moved.evidence,
    statements: moved.patient_statements, missingRecords: moved.missing_records, requests: moved.record_requests, shares: moved.share_links,
  })
  return { survivorId: m.survivorId, moved }
}
