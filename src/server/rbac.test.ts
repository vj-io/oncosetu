import { describe, expect, it } from 'vitest'
import { can, PERMISSIONS, type Permission, type Role } from './rbac'

const ALL: Role[] = ['patient', 'caregiver', 'desk', 'records', 'clinician', 'org_admin', 'auditor', 'system']
const holders = (p: Permission) => ALL.filter((r) => can(r, p))

describe('RBAC matrix (PRD §6.1)', () => {
  it('desk cannot verify or read extracted clinical content', () => {
    for (const p of ['verify.records_tier', 'verify.clinician_tier', 'ledger.read', 'evidence.read', 'document.view_content'] as Permission[]) {
      expect(can('desk', p)).toBe(false)
    }
    expect(can('desk', 'ledger.headlines')).toBe(true)
    expect(can('desk', 'document.attach')).toBe(true)
  })
  it('records cannot verify clinician-tier items; clinician can', () => {
    expect(can('records', 'verify.records_tier')).toBe(true)
    expect(can('records', 'verify.clinician_tier')).toBe(false)
    expect(holders('verify.clinician_tier')).toEqual(['clinician'])
  })
  it('only clinicians set disclosure status and seal snapshots', () => {
    expect(holders('disclosure.set')).toEqual(['clinician'])
    expect(holders('snapshot.seal')).toEqual(['clinician'])
  })
  it('org_admin and auditor never read patient content', () => {
    for (const r of ['org_admin', 'auditor'] as Role[]) {
      for (const p of ['document.view_content', 'ledger.read', 'evidence.read', 'patient.lookup'] as Permission[]) expect(can(r, p)).toBe(false)
    }
    expect(can('auditor', 'audit.read')).toBe(true)
    expect(can('auditor', 'staff.manage')).toBe(false)
  })
  it('system runs jobs but never verifies', () => {
    expect(can('system', 'pipeline.run')).toBe(true)
    expect(Object.keys(PERMISSIONS).filter((p) => p.startsWith('verify.') && can('system', p as Permission))).toEqual([])
  })
  it('caregiver cannot grant itself scope; patient can', () => {
    expect(can('caregiver', 'caregiver.manage')).toBe(false)
    expect(can('patient', 'caregiver.manage')).toBe(true)
  })
  it('share links are patient-initiated only', () => {
    expect(holders('share.manage')).toEqual(['patient', 'caregiver'])
  })
  it('every permission has at least one holder', () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) expect(holders(p).length).toBeGreaterThan(0)
  })
})
