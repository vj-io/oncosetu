// Devices, break-glass review, settings and the overview counts.
import { and, count, desc, eq, gt, inArray, isNull, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Tx } from '@/db'
import { auditLog, breakGlass, devices, measurementForms, orgSettings, ruleStates, staff, type OrgFlags } from '@/db/schema'
import { RADAR_RULES } from '@/core/radar/rules'
import { isDemo } from '../demo'
import { HttpError } from '../http'
import type { AdminCtx } from './ctx'
import { accession } from './format'
import { listDuplicates, listMerges } from './duplicates'

// ── devices (FR-OFF-06; revoking goes through the Offline agent's POST /api/devices/[id]/revoke) ──
export type DeviceState = 'active' | 'revoked_awaiting_wipe' | 'wiped'

export async function listDevices(tx: Tx, orgId: string) {
  const rows = await tx.select({ d: devices, by: staff.name }).from(devices).leftJoin(staff, eq(staff.id, devices.registeredBy))
    .where(eq(devices.orgId, orgId)).orderBy(desc(devices.registeredAt))
  return rows.map(({ d, by }) => ({
    id: d.id, label: d.label, registeredBy: by, registeredAt: d.registeredAt, lastSeenAt: d.lastSeenAt, revokedAt: d.revokedAt, wipedAt: d.wipedAt,
    state: (d.revokedAt ? (d.wipedAt ? 'wiped' : 'revoked_awaiting_wipe') : 'active') as DeviceState,
  }))
}

// ── break-glass review (FR-ID-10) ──
// The org_admin alert: every grant stays on /admin (banner) until an org_admin marks it reviewed. Staff have no phone
// or email channel in the schema, so the alert is in-app; the patient gets the SMS.
export async function listBreakGlass(tx: Tx, orgId: string) {
  const reviewer = alias(staff, 'reviewer')
  const rows = await tx.select({ g: breakGlass, who: staff.name, role: staff.role, reviewedByName: reviewer.name }).from(breakGlass)
    .innerJoin(staff, eq(staff.id, breakGlass.staffId)).leftJoin(reviewer, eq(reviewer.id, breakGlass.reviewedBy))
    .where(eq(breakGlass.orgId, orgId)).orderBy(desc(breakGlass.createdAt)).limit(200)
  const t = Date.now()
  return rows.map(({ g, who, role, reviewedByName }) => ({
    id: g.id, staffId: g.staffId, patient: accession(g.patientId), staff: who, role, reason: g.reason, createdAt: g.createdAt, expiresAt: g.expiresAt, active: g.expiresAt.getTime() > t,
    reviewedAt: g.reviewedAt, reviewedBy: reviewedByName,
  }))
}

/** The emergency-access grant now in force for this person and patient (latest end time), if any. */
export async function activeGrantFor(tx: Tx, patientId: string, staffId: string): Promise<{ expiresAt: Date; reason: string } | null> {
  const [g] = await tx.select({ expiresAt: breakGlass.expiresAt, reason: breakGlass.reason }).from(breakGlass)
    .where(and(eq(breakGlass.patientId, patientId), eq(breakGlass.staffId, staffId), gt(breakGlass.expiresAt, new Date()))).orderBy(desc(breakGlass.expiresAt)).limit(1)
  return g ?? null
}

export async function unreviewedBreakGlass(tx: Tx, orgId: string): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(breakGlass).where(and(eq(breakGlass.orgId, orgId), isNull(breakGlass.reviewedAt)))
  return r.n
}

/** Grants nobody has reviewed yet: who made each (id and role), for the alert wording and for who may review. */
export async function unreviewedGrants(tx: Tx, orgId: string) {
  return tx.select({ staffId: breakGlass.staffId, role: staff.role }).from(breakGlass).innerJoin(staff, eq(staff.id, breakGlass.staffId))
    .where(and(eq(breakGlass.orgId, orgId), isNull(breakGlass.reviewedAt)))
}

/**
 * Who may review a grant (FR-ID-10). The rule keeps a second person involved every time:
 *  1. Nobody reviews their own grant.
 *  2. Another administrator may always review.
 *  3. An auditor may review only when no other active administrator exists besides the person who made the grant
 *     (a hospital with one administrator). The audit row records the reviewer's role and that the fallback was used.
 * Pure, so the page can say who must review and the server enforces the same rule.
 */
export function breakGlassReviewer(input: { grantStaffId: string; activeAdminIds: readonly string[] }): { admins: boolean; auditors: boolean } {
  const otherAdmins = input.activeAdminIds.filter((id) => id !== input.grantStaffId)
  return { admins: true, auditors: otherAdmins.length === 0 }
}

/** What the grants page shows for one grant: a button, or a plain sentence saying who must review. */
export function reviewState(input: { reviewedAt: Date | null; grantStaffId: string; viewerId: string; viewerRole: string; activeAdminIds: readonly string[] }):
  { kind: 'done' } | { kind: 'can_review' } | { kind: 'waiting'; text: string } {
  if (input.reviewedAt) return { kind: 'done' }
  const who = breakGlassReviewer({ grantStaffId: input.grantStaffId, activeAdminIds: input.activeAdminIds })
  const mine = input.viewerId === input.grantStaffId
  if (mine) return { kind: 'waiting', text: who.auditors ? 'This is your own access, so you cannot review it. As the only administrator, ask the hospital auditor to review it.' : 'This is your own access, so another administrator must review it.' }
  if (input.viewerRole === 'org_admin') return { kind: 'can_review' }
  if (input.viewerRole === 'auditor') return who.auditors ? { kind: 'can_review' } : { kind: 'waiting', text: 'Another administrator reviews this one.' }
  return { kind: 'waiting', text: 'Not yet reviewed' }
}

export async function activeAdminIds(tx: Tx, orgId: string): Promise<string[]> {
  const rows = await tx.select({ id: staff.id }).from(staff).where(and(eq(staff.orgId, orgId), eq(staff.role, 'org_admin'), eq(staff.active, true)))
  return rows.map((r) => r.id)
}

/** Reviews a grant once. Never one's own; an auditor only where the rule above allows it. The audit row carries ids and the reviewer's role. */
export async function reviewBreakGlass(ctx: AdminCtx, id: string) {
  const role = ctx.session.role
  if (role !== 'org_admin' && role !== 'auditor') throw new HttpError(403, 'forbidden', 'Not allowed')
  const [x] = await ctx.db.select({ staffId: breakGlass.staffId, reviewedAt: breakGlass.reviewedAt }).from(breakGlass)
    .where(and(eq(breakGlass.id, id), eq(breakGlass.orgId, ctx.session.orgId)))
  if (!x) throw new HttpError(404, 'not_found', 'Not found')
  if (x.reviewedAt) throw new HttpError(409, 'already_reviewed', 'This grant has already been reviewed')
  if (x.staffId === ctx.session.staffId) throw new HttpError(409, 'own_grant', 'You cannot review your own emergency access. Another person must.')
  if (role === 'auditor' && !breakGlassReviewer({ grantStaffId: x.staffId, activeAdminIds: await activeAdminIds(ctx.db, ctx.session.orgId) }).auditors) {
    throw new HttpError(409, 'admin_reviews', 'Another administrator reviews this grant. An auditor reviews only when the hospital has no other administrator.')
  }
  const [g] = await ctx.db.update(breakGlass).set({ reviewedAt: new Date(), reviewedBy: ctx.session.staffId })
    .where(and(eq(breakGlass.id, id), eq(breakGlass.orgId, ctx.session.orgId), isNull(breakGlass.reviewedAt), ne(breakGlass.staffId, ctx.session.staffId)))
    .returning({ patientId: breakGlass.patientId, staffId: breakGlass.staffId })
  if (!g) throw new HttpError(409, 'already_reviewed', 'This grant has already been reviewed')
  await ctx.audit('break_glass.reviewed', 'patient', g.patientId, { breakGlassId: id, grantedTo: g.staffId, reviewerRole: role, fallback: role === 'auditor' })
}

// ── settings (FR-ADM-04, §10.5) ──
export const MIN_RETENTION_DAYS = 3 * 365
export const DAY_S = 86_400

export async function loadSettings(tx: Tx, orgId: string) {
  const [s] = await tx.select().from(orgSettings).where(eq(orgSettings.orgId, orgId))
  return {
    flags: s?.flags ?? { voice: false, tts: false, ai_extraction: false }, retentionDays: s?.retentionDays ?? 3650,
    demoClockOffsetS: s?.demoClockOffsetS ?? 0, updatedAt: s?.updatedAt ?? null, demo: isDemo(),
    llmBudget: { calls: s?.llmDailyCalls ?? 1000, tokens: s?.llmDailyTokens ?? 10_000_000 },
  }
}

/** PRD §9.6 bounds for the per-org daily LLM budget (0 switches AI-assisted reading off in practice). */
export const LLM_BUDGET_MAX = { calls: 100_000, tokens: 1_000_000_000 } as const

async function upsertSettings(ctx: AdminCtx, set: Partial<typeof orgSettings.$inferInsert>) {
  const orgId = ctx.session.orgId
  await ctx.db.insert(orgSettings).values({ orgId, ...set }).onConflictDoUpdate({ target: orgSettings.orgId, set: { ...set, updatedAt: new Date() } })
}

type FlagSwitches = Omit<OrgFlags, 'questions'>

export async function saveSettings(ctx: AdminCtx, input: { flags?: FlagSwitches; questions?: NonNullable<OrgFlags['questions']>; retentionDays?: number; llmBudget?: { calls: number; tokens: number } }) {
  const before = await loadSettings(ctx.db, ctx.session.orgId)
  if (input.retentionDays != null && input.retentionDays < MIN_RETENTION_DAYS) {
    throw new HttpError(400, 'retention_too_short', 'Retention cannot be shorter than 3 years (1095 days)')
  }
  // flags is one JSON column: switches and the question setting are saved separately, so merge onto what is stored
  const flags = input.flags || input.questions ? { ...before.flags, ...input.flags, ...(input.questions ? { questions: input.questions } : {}) } : null
  await upsertSettings(ctx, {
    ...(flags ? { flags } : {}), ...(input.retentionDays != null ? { retentionDays: input.retentionDays } : {}),
    ...(input.llmBudget ? { llmDailyCalls: input.llmBudget.calls, llmDailyTokens: input.llmBudget.tokens } : {}),
  })
  if (input.llmBudget && (input.llmBudget.calls !== before.llmBudget.calls || input.llmBudget.tokens !== before.llmBudget.tokens)) {
    await ctx.audit('settings.llm_budget', 'org_settings', ctx.session.orgId, { from: [before.llmBudget.calls, before.llmBudget.tokens], to: [input.llmBudget.calls, input.llmBudget.tokens] })
  }
  if (input.flags) {
    const changed = (Object.keys(input.flags) as (keyof FlagSwitches)[]).filter((k) => input.flags![k] !== before.flags[k])
    await ctx.audit('settings.flags', 'org_settings', ctx.session.orgId, { changed, ...input.flags })
  }
  if (input.questions) {
    await ctx.audit('settings.questions', 'org_settings', ctx.session.orgId, {
      order: input.questions.map((q) => q.id), off: input.questions.filter((q) => !q.on).map((q) => q.id),
    })
  }
  if (input.retentionDays != null && input.retentionDays !== before.retentionDays) {
    await ctx.audit('settings.retention', 'org_settings', ctx.session.orgId, { from: before.retentionDays, to: input.retentionDays })
  }
}

export const DEMO_CLOCK_PRESETS = { plus7: 7, plus21: 21, reset: 0 } as const

/** Demo only: now() = real time + offset, which drives request reminders (V04-E2E-02). */
export async function setDemoClock(ctx: AdminCtx, preset: keyof typeof DEMO_CLOCK_PRESETS) {
  if (!isDemo()) throw new HttpError(404, 'not_found', 'Not found')
  const days = DEMO_CLOCK_PRESETS[preset]
  await upsertSettings(ctx, { demoClockOffsetS: days * DAY_S })
  await ctx.audit('settings.demo_clock', 'org_settings', ctx.session.orgId, { offsetDays: days })
  return { offsetDays: days }
}

// ── overview tiles ──
export async function overviewCounts(tx: Tx, orgId: string) {
  const [[staffN], [auditN], [devN], [bgN], [formsN], modes] = await Promise.all([
    tx.select({ n: count() }).from(staff).where(and(eq(staff.orgId, orgId), eq(staff.active, true))),
    tx.select({ n: count() }).from(auditLog).where(eq(auditLog.orgId, orgId)),
    tx.select({ n: count() }).from(devices).where(and(eq(devices.orgId, orgId), isNull(devices.revokedAt))),
    tx.select({ n: count() }).from(breakGlass).where(and(eq(breakGlass.orgId, orgId), gt(breakGlass.expiresAt, new Date()))),
    tx.select({ n: count() }).from(measurementForms).where(eq(measurementForms.orgId, orgId)),
    tx.select({ id: ruleStates.ruleId }).from(ruleStates).where(and(eq(ruleStates.orgId, orgId), eq(ruleStates.mode, 'production'), inArray(ruleStates.ruleId, RADAR_RULES.map((r) => r.id)))),
  ])
  return {
    staff: staffN.n, audit: auditN.n, devices: devN.n, breakGlassActive: bgN.n, forms: formsN.n,
    rulesProduction: modes.length, rulesTotal: RADAR_RULES.length,
  }
}

/** Separate from overviewCounts: detection decrypts names in memory, so only roles that may act on it run it. */
export async function duplicateCounts(tx: Tx, orgId: string) {
  const merges = await listMerges(tx, orgId)
  return { pendingMerges: merges.filter((m) => m.state === 'requested').length, candidates: (await listDuplicates(tx, orgId, merges)).length }
}
