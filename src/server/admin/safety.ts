// "Blocked and held" panel: recent safety events read from the existing audit log, share-link opens and document flags.
// Run inside withOrg (RLS). Nothing here writes, and nothing carries a name, a quote or document text.
import { and, desc, eq, gt, inArray, or } from 'drizzle-orm'
import type { Tx } from '@/db'
import { auditLog, breakGlass, documents, shareViews, staff } from '@/db/schema'
import { describeSafety, SAFETY_AUDIT_ACTIONS, tally, type RawSafety, type SafetyEvent } from '@/core/doctor/safety-events'
import { accession } from '../registration/http'

const WINDOW_DAYS = 30
const DAY_MS = 86_400_000

export type SafetyRow = SafetyEvent & { patientCode: string | null }

export async function loadSafetyEvents(tx: Tx, orgId: string, now: Date, limit = 150) {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS)
  const [audits, shares, docs] = await Promise.all([
    tx.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), gt(auditLog.at, since), inArray(auditLog.action, [...SAFETY_AUDIT_ACTIONS]))).orderBy(desc(auditLog.seq)).limit(400),
    tx.select({ at: shareViews.at, outcome: shareViews.outcome, patientId: shareViews.patientId }).from(shareViews)
      .where(and(eq(shareViews.orgId, orgId), gt(shareViews.at, since))).orderBy(desc(shareViews.at)).limit(300),
    tx.select({ id: documents.id, patientId: documents.patientId, at: documents.updatedAt, identityResult: documents.identityResult, handwritten: documents.handwritten, injectionFlag: documents.injectionFlag })
      .from(documents).where(and(eq(documents.orgId, orgId), gt(documents.updatedAt, since), or(eq(documents.identityResult, 'mismatch'), eq(documents.injectionFlag, true), eq(documents.handwritten, true)))).limit(300),
  ])

  const actorIds = [...new Set(audits.filter((r) => r.actorRole !== 'patient' && r.actorRole !== 'caregiver' && r.actorRole !== 'system').map((r) => r.actorId).filter((x): x is string => !!x))]
  const bgIds = audits.filter((r) => r.action === 'break_glass.granted').map((r) => String((r.details as { breakGlassId?: string }).breakGlassId ?? '')).filter(Boolean)
  const docIds = audits.filter((r) => r.targetType === 'document' && r.targetId).map((r) => r.targetId!)
  const [names, bg, docPatients] = await Promise.all([
    actorIds.length ? tx.select({ id: staff.id, name: staff.name }).from(staff).where(inArray(staff.id, actorIds)) : [],
    bgIds.length ? tx.select({ id: breakGlass.id, reason: breakGlass.reason }).from(breakGlass).where(inArray(breakGlass.id, bgIds)) : [],
    docIds.length ? tx.select({ id: documents.id, patientId: documents.patientId }).from(documents).where(inArray(documents.id, docIds)) : [],
  ])
  const nameOf = new Map(names.map((n) => [n.id, n.name]))
  const reasonOf = new Map(bg.map((b) => [b.id, b.reason]))
  const patientOfDoc = new Map(docPatients.map((d) => [d.id, d.patientId]))

  const raw: RawSafety[] = [
    ...audits.map((r): RawSafety => {
      const d = (r.details ?? {}) as Record<string, unknown>
      const patientId = typeof d.patientId === 'string' ? d.patientId
        : r.targetType === 'patient' ? r.targetId : r.targetType === 'document' && r.targetId ? patientOfDoc.get(r.targetId) ?? null : null
      return {
        source: 'audit', at: r.at, action: r.action, details: d, actorRole: r.actorRole, actorName: (r.actorId && nameOf.get(r.actorId)) || null,
        patientId, reason: r.action === 'break_glass.granted' ? reasonOf.get(String(d.breakGlassId ?? '')) ?? null : null,
      }
    }),
    ...shares.map((s): RawSafety => ({ source: 'share_view', at: s.at, outcome: s.outcome, patientId: s.patientId })),
    ...docs.map((d): RawSafety => ({ source: 'document', at: d.at, patientId: d.patientId, doc: { identityResult: d.identityResult, handwritten: d.handwritten, injectionFlag: d.injectionFlag } })),
  ]
  const events = raw.map(describeSafety).filter((e): e is SafetyEvent => !!e).sort((a, b) => b.at.getTime() - a.at.getTime())
  const rows: SafetyRow[] = events.slice(0, limit).map((e) => ({ ...e, patientCode: e.patientId ? accession(e.patientId) : null }))
  return { rows, counts: tally(events), total: events.length, days: WINDOW_DAYS }
}
