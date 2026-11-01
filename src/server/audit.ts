// Append-only, per-org hash-chained audit log (PRD §7.1, §15.2). Rows carry ids and enums only.
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { withOrg, type Tx } from '@/db'
import { auditLog } from '@/db/schema'
import { sha256Hex } from './crypto'

export const GENESIS_HASH = '0'.repeat(64)

/** Deterministic JSON: object keys sorted recursively, undefined dropped. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (v instanceof Date) return JSON.stringify(v.toISOString())
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`
}

export type AuditDetails = Record<string, string | number | boolean | null | (string | number)[]>

export type AuditRow = {
  id: string; orgId: string; seq: number; at: Date; actorId: string | null; actorRole: string; action: string
  targetType: string | null; targetId: string | null; requestId: string | null; details: Record<string, unknown>
  prevHash: string; hash: string
}

export function auditHash(prevHash: string, r: Omit<AuditRow, 'prevHash' | 'hash'>): string {
  return sha256Hex(prevHash + canonicalJson({
    id: r.id, orgId: r.orgId, seq: r.seq, at: r.at.toISOString(), actorId: r.actorId, actorRole: r.actorRole,
    action: r.action, targetType: r.targetType, targetId: r.targetId, requestId: r.requestId, details: r.details,
  }))
}

/** Ids/enums/numbers only: reject anything that looks like free text or contact data. */
// ponytail: heuristic guard (no spaces, no '@', ≤100 chars); a name without spaces would still pass.
function assertIdsOnly(details: AuditDetails) {
  for (const [k, v] of Object.entries(details)) {
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x === 'string' && (x.length > 100 || /[\s@]/.test(x))) {
        throw new Error(`audit details.${k} must hold ids/enums only`)
      }
    }
  }
}

export type AuditInput = {
  orgId: string; actorId: string | null; actorRole: string; action: string
  targetType?: string | null; targetId?: string | null; requestId?: string | null; details?: AuditDetails
}

/** Must run inside withOrg(orgId) (RLS). Serialised per org with an advisory lock. */
export async function writeAudit(tx: Tx, a: AuditInput): Promise<{ id: string; seq: number; hash: string }> {
  const details = a.details ?? {}
  assertIdsOnly(details)
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'audit:' + a.orgId}, 0))`)
  const [last] = await tx.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog)
    .where(eq(auditLog.orgId, a.orgId)).orderBy(desc(auditLog.seq)).limit(1)
  const row = {
    id: uuidv7(), orgId: a.orgId, seq: (last?.seq ?? 0) + 1, at: new Date(), actorId: a.actorId, actorRole: a.actorRole,
    action: a.action, targetType: a.targetType ?? null, targetId: a.targetId ?? null, requestId: a.requestId ?? null, details,
  }
  const prevHash = last?.hash ?? GENESIS_HASH
  const hash = auditHash(prevHash, row)
  await tx.insert(auditLog).values({ ...row, prevHash, hash })
  return { id: row.id, seq: row.seq, hash }
}

/** Pure chain check over rows sorted by seq. Returns the first broken seq. */
export function verifyChainRows(rows: AuditRow[], prev: { seq: number; hash: string } = { seq: 0, hash: GENESIS_HASH }) {
  for (const r of rows) {
    if (r.seq !== prev.seq + 1 || r.prevHash !== prev.hash || auditHash(r.prevHash, r) !== r.hash) {
      return { ok: false as const, brokenAt: r.seq, last: prev }
    }
    prev = { seq: r.seq, hash: r.hash }
  }
  return { ok: true as const, last: prev }
}

export async function verifyAuditChain(orgId: string): Promise<{ ok: boolean; brokenAt?: number; checked: number }> {
  let prev = { seq: 0, hash: GENESIS_HASH }
  let checked = 0
  for (;;) {
    const rows = await withOrg(orgId, (tx) => tx.select().from(auditLog)
      .where(and(eq(auditLog.orgId, orgId), gt(auditLog.seq, prev.seq))).orderBy(asc(auditLog.seq)).limit(1000))
    if (!rows.length) return { ok: true, checked }
    const res = verifyChainRows(rows as AuditRow[], prev)
    if (!res.ok) return { ok: false, brokenAt: res.brokenAt, checked: checked + rows.length }
    prev = res.last
    checked += rows.length
  }
}
