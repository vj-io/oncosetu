import { describe, expect, it } from 'vitest'
import { auditHash, canonicalJson, GENESIS_HASH, verifyChainRows, type AuditRow } from './audit'

function chain(n: number): AuditRow[] {
  const rows: AuditRow[] = []
  let prev = GENESIS_HASH
  for (let seq = 1; seq <= n; seq++) {
    const r = {
      id: `id-${seq}`, orgId: 'org-1', seq, at: new Date(Date.UTC(2026, 10, 2, 10, 0, seq)), actorId: 'staff-1',
      actorRole: 'records', action: 'document.attach', targetType: 'document', targetId: `doc-${seq}`, requestId: `req-${seq}`,
      details: { reason: 'match', count: seq },
    }
    const hash = auditHash(prev, r)
    rows.push({ ...r, prevHash: prev, hash })
    prev = hash
  }
  return rows
}

describe('canonicalJson', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}')
  })
})

describe('audit hash chain', () => {
  it('verifies an intact chain', () => {
    expect(verifyChainRows(chain(5)).ok).toBe(true)
  })
  it('detects an edited row', () => {
    const rows = chain(5)
    rows[2] = { ...rows[2], details: { reason: 'mismatch', count: 3 } }
    expect(verifyChainRows(rows)).toMatchObject({ ok: false, brokenAt: 3 })
  })
  it('detects an edited actor even if the row hash is recomputed (next link breaks)', () => {
    const rows = chain(5)
    const forged = { ...rows[1], actorId: 'staff-2' }
    forged.hash = auditHash(forged.prevHash, forged)
    rows[1] = forged
    expect(verifyChainRows(rows)).toMatchObject({ ok: false, brokenAt: 3 })
  })
  it('detects a deleted row', () => {
    const rows = chain(5)
    rows.splice(2, 1)
    expect(verifyChainRows(rows)).toMatchObject({ ok: false, brokenAt: 4 })
  })
  it('detects a truncated head', () => {
    expect(verifyChainRows(chain(5).slice(1))).toMatchObject({ ok: false, brokenAt: 2 })
  })
})
