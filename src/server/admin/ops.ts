// Devices, break-glass review, settings and the overview counts.
import { and, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
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
export async function listBreakGlass(tx: Tx, orgId: string) {
  const rows = await tx.select({ g: breakGlass, who: staff.name, role: staff.role }).from(breakGlass).innerJoin(staff, eq(staff.id, breakGlass.staffId))
    .where(eq(breakGlass.orgId, orgId)).orderBy(desc(breakGlass.createdAt)).limit(200)
  const t = Date.now()
  return rows.map(({ g, who, role }) => ({
    id: g.id, patient: accession(g.patientId), staff: who, role, reason: g.reason, createdAt: g.createdAt, expiresAt: g.expiresAt, active: g.expiresAt.getTime() > t,
  }))
}

// ── settings (FR-ADM-04, §10.5) ──
export const MIN_RETENTION_DAYS = 3 * 365
export const DAY_S = 86_400

export async function loadSettings(tx: Tx, orgId: string) {
  const [s] = await tx.select().from(orgSettings).where(eq(orgSettings.orgId, orgId))
  return {
    flags: s?.flags ?? { voice: false, tts: false, ai_extraction: false }, retentionDays: s?.retentionDays ?? 3650,
    demoClockOffsetS: s?.demoClockOffsetS ?? 0, updatedAt: s?.updatedAt ?? null, demo: isDemo(),
  }
}

async function upsertSettings(ctx: AdminCtx, set: Partial<typeof orgSettings.$inferInsert>) {
  const orgId = ctx.session.orgId
  await ctx.db.insert(orgSettings).values({ orgId, ...set }).onConflictDoUpdate({ target: orgSettings.orgId, set: { ...set, updatedAt: new Date() } })
}

type FlagSwitches = Omit<OrgFlags, 'questions'>

export async function saveSettings(ctx: AdminCtx, input: { flags?: FlagSwitches; questions?: NonNullable<OrgFlags['questions']>; retentionDays?: number }) {
  const before = await loadSettings(ctx.db, ctx.session.orgId)
  if (input.retentionDays != null && input.retentionDays < MIN_RETENTION_DAYS) {
    throw new HttpError(400, 'retention_too_short', 'Retention cannot be shorter than 3 years (1095 days)')
  }
  // flags is one JSON column: switches and the question setting are saved separately, so merge onto what is stored
  const flags = input.flags || input.questions ? { ...before.flags, ...input.flags, ...(input.questions ? { questions: input.questions } : {}) } : null
  await upsertSettings(ctx, { ...(flags ? { flags } : {}), ...(input.retentionDays != null ? { retentionDays: input.retentionDays } : {}) })
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
