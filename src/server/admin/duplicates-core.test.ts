import { describe, expect, it } from 'vitest'
import { checkMergeApproval, findDuplicatePairs, type DupPatient } from './duplicates-core'
import { wouldRemoveLastAdmin } from './staff-core'

const p = (id: string, o: Partial<DupPatient> = {}): DupPatient => ({
  id, status: 'active', phoneHmac: null, abhaHmac: null, identityHmac: null, name: `Person ${id}`, aliases: [], dob: null, mrn: null, ...o,
})

describe('findDuplicatePairs', () => {
  it('flags a shared ABHA as high confidence', () => {
    const r = findDuplicatePairs([p('a', { abhaHmac: 'X' }), p('b', { abhaHmac: 'X' }), p('c')])
    expect(r).toEqual([{ a: 'a', b: 'b', reasons: ['abha'], confidence: 'high' }])
  })
  it('flags a shared phone alone as only possible, and combines reasons', () => {
    expect(findDuplicatePairs([p('a', { phoneHmac: 'P', name: 'Kavita Rao' }), p('b', { phoneHmac: 'P', name: 'Sanjay Gupta' })])[0]).toMatchObject({ reasons: ['phone'], confidence: 'possible' })
    expect(findDuplicatePairs([p('a', { phoneHmac: 'P', identityHmac: 'I', name: 'Kavita Rao' }), p('b', { phoneHmac: 'P', identityHmac: 'I', name: 'Sanjay Gupta' })])[0])
      .toMatchObject({ reasons: ['identity', 'phone'], confidence: 'high' })
  })
  it('matches a transliterated name on the same DOB and rejects a different DOB or name', () => {
    const base = { dob: '1970-04-12' }
    expect(findDuplicatePairs([p('a', { ...base, name: 'Ramesh Kumar Sharma' }), p('b', { ...base, name: 'Rameshkumar Sharma' })])[0]?.reasons).toEqual(['name_dob'])
    expect(findDuplicatePairs([p('a', { ...base, name: 'Ramesh Kumar Sharma' }), p('b', { dob: '1971-04-12', name: 'Ramesh Kumar Sharma' })])).toEqual([])
    expect(findDuplicatePairs([p('a', { ...base, name: 'Ramesh Kumar Sharma' }), p('b', { ...base, name: 'Suresh Patel Joshi' })])).toEqual([])
  })
  it('ignores inactive/merged patients and pairs in the skip set', () => {
    const xs = [p('a', { abhaHmac: 'X' }), p('b', { abhaHmac: 'X', status: 'merged' }), p('c', { abhaHmac: 'X' })]
    expect(findDuplicatePairs(xs)).toHaveLength(1)
    expect(findDuplicatePairs(xs, new Set(['a|c']))).toEqual([])
  })
})

describe('merge two-approval rule (E-ID-06, V06-E2E-05)', () => {
  it('rejects approval by the person who requested the merge', () => {
    expect(checkMergeApproval({ state: 'requested', requestedBy: 'staff-1' }, 'staff-1')).toEqual({ ok: false, code: 'same_person' })
  })
  it('accepts a different staff member', () => {
    expect(checkMergeApproval({ state: 'requested', requestedBy: 'staff-1' }, 'staff-2')).toEqual({ ok: true })
  })
  it('only approves a pending request (no double execution, no approving a rejected one)', () => {
    for (const state of ['approved', 'executed', 'rejected']) {
      expect(checkMergeApproval({ state, requestedBy: 'staff-1' }, 'staff-2')).toEqual({ ok: false, code: 'not_pending' })
    }
  })
})

describe('wouldRemoveLastAdmin', () => {
  const staff = [{ id: 'a', role: 'org_admin', active: true }, { id: 'b', role: 'org_admin', active: false }, { id: 'c', role: 'clinician', active: true }]
  it('blocks deactivating or demoting the only active admin', () => {
    expect(wouldRemoveLastAdmin(staff, 'a', { active: false })).toBe(true)
    expect(wouldRemoveLastAdmin(staff, 'a', { role: 'auditor' })).toBe(true)
  })
  it('allows changes that keep an active admin, and unrelated changes', () => {
    expect(wouldRemoveLastAdmin([...staff, { id: 'd', role: 'org_admin', active: true }], 'a', { active: false })).toBe(false)
    expect(wouldRemoveLastAdmin(staff, 'c', { active: false })).toBe(false)
    expect(wouldRemoveLastAdmin(staff, 'b', { active: true })).toBe(false)
  })
})
