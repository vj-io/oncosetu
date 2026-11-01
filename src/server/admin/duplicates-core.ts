// E-ID-06 / V06-E2E-05: likely-duplicate pairs and the two-approval merge rule. Pure.
// Blocking (shared ABHA / phone / identity key / DOB) keeps this near-linear; the verdict per pair is the Registration
// agent's dupReasons(), so the admin console and the desk warning always agree on what a duplicate is.
import { dupReasons, isStrong, type DupProfile, type DupReason } from '@/server/registration/logic'

export type DupPatient = DupProfile & { id: string; status: string }
export type { DupReason }
export type DupPair = { a: string; b: string; reasons: DupReason[]; confidence: 'high' | 'possible' }

/**
 * Pairs of active patients that dupReasons() links. `skip` holds "a|b" keys (sorted ids) already requested or decided.
 * A bare shared phone is only "possible": families share numbers.
 */
export function findDuplicatePairs(patients: readonly DupPatient[], skip: ReadonlySet<string> = new Set()): DupPair[] {
  const active = patients.filter((p) => p.status === 'active')
  const pairs = new Map<string, DupPair>()
  const group = (by: (p: DupPatient) => string | null) => {
    const g = new Map<string, DupPatient[]>()
    for (const p of active) {
      const k = by(p)
      if (k) g.set(k, [...(g.get(k) ?? []), p])
    }
    for (const xs of g.values()) {
      for (let i = 0; i < xs.length; i++) {
        for (let j = i + 1; j < xs.length; j++) {
          const [a, b] = xs[i].id < xs[j].id ? [xs[i], xs[j]] : [xs[j], xs[i]]
          const key = `${a.id}|${b.id}`
          if (pairs.has(key) || skip.has(key)) continue
          const reasons = dupReasons(a, b)
          if (reasons.length) pairs.set(key, { a: a.id, b: b.id, reasons, confidence: isStrong(reasons) ? 'high' : 'possible' })
        }
      }
    }
  }
  group((p) => p.abhaHmac)
  group((p) => p.phoneHmac)
  group((p) => p.identityHmac)
  group((p) => p.dob)
  return [...pairs.values()].sort((x, y) => (x.confidence === y.confidence ? y.reasons.length - x.reasons.length : x.confidence === 'high' ? -1 : 1) || x.a.localeCompare(y.a))
}

export type MergeApproval = { ok: true } | { ok: false; code: 'not_pending' | 'same_person' }

/** The approver must be a different staff member than the requester, and the merge must still be pending. */
export function checkMergeApproval(m: { state: string; requestedBy: string }, approverId: string): MergeApproval {
  if (m.state !== 'requested') return { ok: false, code: 'not_pending' }
  if (m.requestedBy === approverId) return { ok: false, code: 'same_person' }
  return { ok: true }
}
