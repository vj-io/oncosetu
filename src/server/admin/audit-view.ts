// FR-ADM-02: audit log viewer + CSV export. Rows hold ids and enums only (see src/server/audit.ts).
import { and, asc, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import type { Tx } from '@/db'
import { auditLog, staff } from '@/db/schema'
import { toCsv } from './csv'

export type AuditFilter = { actorId?: string; action?: string; targetType?: string; from?: string; to?: string }
export const AUDIT_PAGE_SIZE = 50
export const AUDIT_EXPORT_MAX = 50_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const IST = '+05:30'

/** Day boundaries are India days; `to` is inclusive. Malformed values are ignored, never interpolated. */
function where(orgId: string, f: AuditFilter): SQL {
  const c: SQL[] = [eq(auditLog.orgId, orgId)]
  if (f.actorId && UUID.test(f.actorId)) c.push(eq(auditLog.actorId, f.actorId))
  if (f.action) c.push(eq(auditLog.action, f.action))
  if (f.targetType) c.push(eq(auditLog.targetType, f.targetType))
  if (f.from && DATE.test(f.from)) c.push(gte(auditLog.at, new Date(`${f.from}T00:00:00${IST}`)))
  if (f.to && DATE.test(f.to)) c.push(lt(auditLog.at, new Date(new Date(`${f.to}T00:00:00${IST}`).getTime() + 86_400_000)))
  return and(...c)!
}

export async function queryAudit(tx: Tx, orgId: string, f: AuditFilter, page: number) {
  const w = where(orgId, f)
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(w)
  const rows = await tx.select().from(auditLog).where(w).orderBy(desc(auditLog.seq))
    .limit(AUDIT_PAGE_SIZE).offset((Math.max(1, page) - 1) * AUDIT_PAGE_SIZE)
  return { total: n, pages: Math.max(1, Math.ceil(n / AUDIT_PAGE_SIZE)), rows }
}

/** Distinct values for the filter dropdowns, plus staff names for actor display. */
export async function auditFacets(tx: Tx, orgId: string) {
  const [actions, targets, people] = await Promise.all([
    tx.selectDistinct({ v: auditLog.action }).from(auditLog).where(eq(auditLog.orgId, orgId)).orderBy(asc(auditLog.action)),
    tx.selectDistinct({ v: auditLog.targetType }).from(auditLog).where(eq(auditLog.orgId, orgId)).orderBy(asc(auditLog.targetType)),
    tx.select({ id: staff.id, name: staff.name, role: staff.role }).from(staff).where(eq(staff.orgId, orgId)).orderBy(asc(staff.name)),
  ])
  return { actions: actions.map((a) => a.v), targetTypes: targets.flatMap((t) => (t.v ? [t.v] : [])), people }
}

export async function staffNames(tx: Tx, orgId: string): Promise<Map<string, string>> {
  const rows = await tx.select({ id: staff.id, name: staff.name }).from(staff).where(eq(staff.orgId, orgId))
  return new Map(rows.map((r) => [r.id, r.name]))
}

export const AUDIT_CSV_HEADER = ['seq', 'at', 'actor_id', 'actor_role', 'action', 'target_type', 'target_id', 'request_id', 'details', 'prev_hash', 'hash'] as const

type AuditCsvRow = { seq: number; at: Date; actorId: string | null; actorRole: string; action: string; targetType: string | null; targetId: string | null; requestId: string | null; details: Record<string, unknown>; prevHash: string; hash: string }

/** Ids only: actors are ids (no names), details are the ids/enums the audit writer already restricts to. */
export function auditCsv(rows: readonly AuditCsvRow[]): string {
  return toCsv(AUDIT_CSV_HEADER, rows.map((r) => [r.seq, r.at, r.actorId, r.actorRole, r.action, r.targetType, r.targetId, r.requestId, r.details, r.prevHash, r.hash]))
}

export async function exportAudit(tx: Tx, orgId: string, f: AuditFilter) {
  const rows = await tx.select().from(auditLog).where(where(orgId, f)).orderBy(asc(auditLog.seq)).limit(AUDIT_EXPORT_MAX + 1)
  const kept = rows.slice(0, AUDIT_EXPORT_MAX)
  return { truncated: rows.length > AUDIT_EXPORT_MAX, count: kept.length, csv: auditCsv(kept) }
}
