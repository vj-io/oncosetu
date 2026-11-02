// J8 (PRD §6.3, §10.5): after consent is withdrawn, the patient, a caregiver, or records/clinician staff on the patient's
// request can record an erasure request. Access has already stopped (consent is checked on use); the request waits in the
// queue until `eligible_after`, then executeErasure() runs the DB function erase_patient (drizzle/0006), which re-checks
// every precondition itself and deletes in the caller's transaction.
import { and, desc, eq, inArray, lte, max, sql } from 'drizzle-orm'
import type { Tx } from '@/db'
import { auditLog, consents, encounters, erasureRequests, orgSettings, patients } from '@/db/schema'
import type { AuditDetails } from '../audit'
import { now } from '../clock'
import { HttpError } from '../http'
import { activeConsent } from '../patients'
import { can } from '../rbac'
import { sessionRole, type Session } from '../session'
import { erasureEligibleAfter } from './eligible'

type Ctx = {
  db: Tx; session: Session
  audit: (action: string, targetType: string | null, targetId: string | null, details?: AuditDetails) => Promise<void>
}
export type ErasureState = typeof erasureRequests.$inferSelect['state']
export type ErasureView = { id: string; state: ErasureState; requestedAt: string; eligibleAfter: string; completedAt: string | null }

const OPEN: ErasureState[] = ['queued', 'scheduled']
const view = (r: typeof erasureRequests.$inferSelect): ErasureView => ({
  id: r.id, state: r.state, requestedAt: r.requestedAt.toISOString(), eligibleAfter: r.eligibleAfter.toISOString(), completedAt: r.completedAt?.toISOString() ?? null,
})

/** The patient's latest request that is still in force or finished (a cancelled one no longer counts), or null. */
export async function loadErasure(tx: Tx, patientId: string): Promise<ErasureView | null> {
  const [r] = await tx.select().from(erasureRequests).where(eq(erasureRequests.patientId, patientId))
    .orderBy(desc(erasureRequests.requestedAt), desc(erasureRequests.id)).limit(1)
  return r && r.state !== 'cancelled' ? view(r) : null
}

/**
 * Records an erasure request. Needs no active "store" consent (withdraw first), so the same call serves the patient
 * portal and the staff denial screen, where assertPatientAccess would refuse. Idempotent: an open request is returned as is.
 */
export async function requestErasure(ctx: Ctx, patientId: string): Promise<ErasureView & { created: boolean }> {
  const s = ctx.session
  if (!can(sessionRole(s), 'erasure.request')) throw new HttpError(403, 'forbidden', 'Not allowed')
  if (s.kind !== 'staff' && s.patientId !== patientId) throw new HttpError(404, 'not_found', 'Not found')
  const [p] = await ctx.db.select({ orgId: patients.orgId }).from(patients).where(eq(patients.id, patientId))
  if (!p || p.orgId !== s.orgId) throw new HttpError(404, 'not_found', 'Not found')
  if ((await activeConsent(ctx.db, patientId))?.purposes.store) {
    throw new HttpError(409, 'consent_active', 'Consent is still active. Withdraw it before requesting erasure.')
  }
  const [open] = await ctx.db.select().from(erasureRequests).where(and(eq(erasureRequests.patientId, patientId), inArray(erasureRequests.state, OPEN))).limit(1)
  if (open) return { ...view(open), created: false }

  const at = await now(s.orgId)
  const [[settings], [last]] = await Promise.all([
    ctx.db.select({ days: orgSettings.retentionDays }).from(orgSettings).where(eq(orgSettings.orgId, s.orgId)),
    ctx.db.select({ at: max(encounters.startedAt) }).from(encounters).where(eq(encounters.patientId, patientId)),
  ])
  const by = s.kind === 'staff' ? { kind: 'staff' as const, id: s.staffId } : { kind: s.kind, id: s.caregiverId ?? s.patientId }
  const [row] = await ctx.db.insert(erasureRequests).values({
    orgId: s.orgId, patientId, requestedByKind: by.kind, requestedById: by.id, requestedAt: at,
    eligibleAfter: erasureEligibleAfter({ requestedAt: at, retentionDays: settings?.days ?? 3650, lastEncounterAt: last?.at ?? null }),
  }).returning()
  await ctx.audit('erasure.request', 'erasure_request', row.id, { patientId, requestedBy: by.kind })
  return { ...view(row), created: true }
}

export type ErasureCounts = Record<string, number>
export type ErasureRow = ErasureView & {
  patientId: string; requestedByKind: 'patient' | 'caregiver' | 'staff'
  /** open and eligible_after has passed (real time, like the DB function) */
  due: boolean
  /** rows removed per table, from the erasure.executed audit row; null until completed */
  counts: ErasureCounts | null
}

/** Admin list, newest first. Ids only (org_admin never reads patient content). */
export async function listErasureRequests(tx: Tx, orgId: string, limit = 200): Promise<ErasureRow[]> {
  const rows = await tx.select({ r: erasureRequests, due: sql<boolean>`${erasureRequests.eligibleAfter} <= now()` }).from(erasureRequests)
    .where(eq(erasureRequests.orgId, orgId)).orderBy(desc(erasureRequests.requestedAt)).limit(limit)
  const done = rows.filter(({ r }) => r.state === 'completed').map(({ r }) => r.id)
  const audits = done.length ? await tx.select({ id: auditLog.targetId, details: auditLog.details }).from(auditLog)
    .where(and(eq(auditLog.action, 'erasure.executed'), inArray(auditLog.targetId, done))) : []
  // the audit row holds { patientId, <table>: <rows> }: the numbers are the counts
  const counts = new Map(audits.map((a) => [a.id, Object.fromEntries(Object.entries(a.details).filter(([, v]) => typeof v === 'number')) as ErasureCounts]))
  return rows.map(({ r, due }) => ({
    ...view(r), patientId: r.patientId, requestedByKind: r.requestedByKind,
    due: OPEN.includes(r.state) && due, counts: counts.get(r.id) ?? null,
  }))
}

type ExecCtx = Pick<Ctx, 'db' | 'audit'>
const REFUSED: Record<string, [number, string]> = {
  erasure_not_found: [404, 'Not found'],
  erasure_not_open: [409, 'This request is not open'],
  erasure_not_eligible: [409, 'Not yet eligible: the retention period has not run'],
  erasure_consent_active: [409, 'Consent is active again; nothing was erased'],
}

/**
 * Deletes the patient's originals and derived data and leaves the tombstone (drizzle/0006 lists what is kept and why).
 * The DB function enforces org, state, eligibility and withdrawn consent; a refusal becomes a 404/409 and, because the
 * call runs in a savepoint, leaves the caller's transaction usable (run-due carries on with the next request).
 */
export async function executeErasure(ctx: ExecCtx, requestId: string): Promise<{ id: string; patientId: string; counts: ErasureCounts }> {
  let counts: ErasureCounts
  try {
    counts = await ctx.db.transaction(async (sp) =>
      (await sp.execute<{ counts: ErasureCounts }>(sql`select erase_patient(${requestId}) as counts`))[0].counts)
  } catch (e) {
    const msg = (e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message
    const known = REFUSED[msg]
    if (known) throw new HttpError(known[0], msg.replace('erasure_', ''), known[1])
    throw e
  }
  const [r] = await ctx.db.select({ patientId: erasureRequests.patientId }).from(erasureRequests).where(eq(erasureRequests.id, requestId))
  await ctx.audit('erasure.executed', 'erasure_request', requestId, { patientId: r.patientId, ...counts })
  return { id: requestId, patientId: r.patientId, counts }
}

/** The retention job: executes every request in the current org (RLS) whose eligible_after has passed. */
export async function runDueErasures(ctx: ExecCtx) {
  const due = await ctx.db.select({ id: erasureRequests.id }).from(erasureRequests)
    .where(and(inArray(erasureRequests.state, OPEN), lte(erasureRequests.eligibleAfter, sql`now()`))).orderBy(erasureRequests.eligibleAfter)
  const executed: Awaited<ReturnType<typeof executeErasure>>[] = []
  const refused: { id: string; code: string }[] = []
  for (const { id } of due) {
    try {
      executed.push(await executeErasure(ctx, id))
    } catch (e) {
      if (!(e instanceof HttpError)) throw e
      refused.push({ id, code: e.code })
    }
  }
  return { executed, refused }
}

/** Consent turned back on: a request still waiting is cancelled, so nothing queued can outlive the patient's change of mind. Returns the ids. */
export async function cancelOpenErasure(tx: Tx, patientId: string): Promise<string[]> {
  const rows = await tx.update(erasureRequests).set({ state: 'cancelled' })
    .where(and(eq(erasureRequests.patientId, patientId), inArray(erasureRequests.state, OPEN))).returning({ id: erasureRequests.id })
  return rows.map((r) => r.id)
}

/** For the staff denial screen: was consent withdrawn, and where does any erasure request stand. */
export async function erasureContext(tx: Tx, patientId: string): Promise<{ withdrawn: boolean; erasure: ErasureView | null }> {
  const [last] = await tx.select({ action: consents.action }).from(consents).where(eq(consents.patientId, patientId))
    .orderBy(desc(consents.recordedAt), desc(consents.id)).limit(1)
  return { withdrawn: last?.action === 'withdraw', erasure: await loadErasure(tx, patientId) }
}
