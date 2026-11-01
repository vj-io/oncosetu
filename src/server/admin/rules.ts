// FR-RAD-05 / ADR-002: rule library view and shadow ⇄ production switch, per organisation.
import { and, count, eq, inArray } from 'drizzle-orm'
import type { Tx } from '@/db'
import { missingRecords, ruleStates, staff } from '@/db/schema'
import { lintText } from '@/core/copy'
import { RADAR_RULES, type RadarRule } from '@/core/radar/rules'
import { HttpError } from '../http'
import type { AdminCtx } from './ctx'

export type RuleRow = {
  rule: RadarRule
  mode: 'production' | 'shadow'
  reviewedBy: string | null // reviewing clinician's name (staff)
  reviewedAt: Date | null
  shadowHits: number
  productionItems: number
  wordingHits: number // banned administrative-wording terms found in EN+HI templates (must be 0)
}

export async function listRules(tx: Tx, orgId: string): Promise<RuleRow[]> {
  const states = await tx.select({ ruleId: ruleStates.ruleId, mode: ruleStates.mode, reviewedAt: ruleStates.reviewedAt, reviewer: staff.name })
    .from(ruleStates).leftJoin(staff, eq(staff.id, ruleStates.reviewedBy)).where(eq(ruleStates.orgId, orgId))
  const counts = await tx.select({ ruleId: missingRecords.ruleId, mode: missingRecords.mode, n: count() }).from(missingRecords)
    .where(eq(missingRecords.orgId, orgId)).groupBy(missingRecords.ruleId, missingRecords.mode)
  return RADAR_RULES.map((rule) => {
    const st = states.find((s) => s.ruleId === rule.id)
    const n = (mode: string) => counts.find((c) => c.ruleId === rule.id && c.mode === mode)?.n ?? 0
    // no rule_states row = the YAML default (core/README, radar)
    return {
      rule, mode: st?.mode ?? (rule.clinician_reviewed ? 'production' : 'shadow'), reviewedBy: st?.reviewer ?? null, reviewedAt: st?.reviewedAt ?? null,
      shadowHits: n('shadow'), productionItems: n('production'),
      wordingHits: lintText(rule.wording.en, ['radar']).length + lintText(rule.wording.hi, ['radar']).length,
    }
  })
}

/** Clinicians who can be named as the reviewer of a rule's wording. */
export async function listReviewers(tx: Tx, orgId: string) {
  return tx.select({ id: staff.id, name: staff.name }).from(staff)
    .where(and(eq(staff.orgId, orgId), eq(staff.role, 'clinician'), eq(staff.active, true))).orderBy(staff.name)
}

export async function setRuleMode(ctx: AdminCtx, ruleId: string, mode: 'production' | 'shadow', reviewerId?: string) {
  const orgId = ctx.session.orgId
  if (!RADAR_RULES.some((r) => r.id === ruleId)) throw new HttpError(404, 'not_found', 'Unknown rule')
  let reviewedBy: string | null | undefined
  if (mode === 'production') {
    if (!reviewerId) throw new HttpError(400, 'reviewer_required', 'Name the reviewing clinician')
    const [rv] = await ctx.db.select({ id: staff.id }).from(staff)
      .where(and(eq(staff.id, reviewerId), eq(staff.orgId, orgId), eq(staff.role, 'clinician'), eq(staff.active, true)))
    if (!rv) throw new HttpError(400, 'reviewer_invalid', 'The reviewer must be an active clinician of this organisation')
    reviewedBy = rv.id
  }
  const reviewedAt = mode === 'production' ? new Date() : undefined
  await ctx.db.insert(ruleStates).values({ orgId, ruleId, mode, reviewedBy: reviewedBy ?? null, reviewedAt: reviewedAt ?? null })
    .onConflictDoUpdate({
      target: [ruleStates.orgId, ruleStates.ruleId],
      set: mode === 'production' ? { mode, reviewedBy, reviewedAt } : { mode },
    })
  // Existing items follow the rule: production items become visible, shadow items hide again.
  const flipped = await ctx.db.update(missingRecords).set({ mode })
    .where(and(eq(missingRecords.orgId, orgId), eq(missingRecords.ruleId, ruleId), inArray(missingRecords.mode, mode === 'production' ? ['shadow'] : ['production'])))
    .returning({ id: missingRecords.id, patientId: missingRecords.patientId })
  await ctx.audit(mode === 'production' ? 'rule.mark_reviewed' : 'rule.return_to_shadow', 'rule', ruleId, {
    mode, itemsFlipped: flipped.length, ...(reviewedBy ? { reviewerId: reviewedBy } : {}),
  })
  return { mode, itemsFlipped: flipped.length, patientIds: [...new Set(flipped.map((f) => f.patientId))] }
}
