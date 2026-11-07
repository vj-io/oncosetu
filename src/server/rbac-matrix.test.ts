import { describe, expect, it } from 'vitest'
import { MATRIX_ROLES, MATRIX_ROWS, matrixCell } from './rbac-matrix'

const cell = (role: (typeof MATRIX_ROLES)[number], key: string) => matrixCell(role, MATRIX_ROWS.find((r) => r.key === key)!)

describe('who can see what (computed from rbac.ts)', () => {
  it('records and clinicians see facts and original files; the desk sees headlines only', () => {
    expect(cell('records', 'facts')).toBe('yes')
    expect(cell('clinician', 'original')).toBe('yes')
    expect(cell('desk', 'facts')).toBe('limited')
    expect(cell('desk', 'original')).toBe('no')
  })
  it('admins and auditors never see facts or original files through their role', () => {
    for (const r of ['org_admin', 'auditor'] as const) { expect(cell(r, 'facts')).toBe('no'); expect(cell(r, 'original')).toBe('no') }
  })
  it('only the clinician seals; only admins manage staff', () => {
    expect(MATRIX_ROLES.filter((r) => cell(r, 'seal') === 'yes')).toEqual(['clinician'])
    expect(MATRIX_ROLES.filter((r) => cell(r, 'admin') === 'yes')).toEqual(['org_admin'])
  })
  it('patients and caregivers can upload, share and manage consent; the share-link viewer is read-only and limited', () => {
    for (const r of ['patient', 'caregiver'] as const) for (const k of ['upload', 'share', 'consent']) expect(cell(r, k)).toBe('yes')
    expect(MATRIX_ROWS.filter((row) => matrixCell('share_viewer', row) === 'yes')).toEqual([])
    expect(cell('share_viewer', 'facts')).toBe('limited')
  })
  it('auditors read the audit log', () => { expect(cell('auditor', 'accesslog')).toBe('yes') })
})
