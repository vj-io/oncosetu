// The read-only "who can see what" table, computed from the real role rules in rbac.ts (PRD §6.1), never typed by hand.
// Conditions that rbac.ts cannot express (consent, verified visit, break-glass) mirror assertPatientAccess in patients.ts.
import { can, type Permission, type Role } from './rbac'

export const MATRIX_ROLES = ['desk', 'records', 'clinician', 'org_admin', 'auditor', 'patient', 'caregiver', 'share_viewer'] as const
export type MatrixRole = (typeof MATRIX_ROLES)[number]
export type Cell = 'yes' | 'limited' | 'no'

type RowDef = {
  key: string
  full: readonly Permission[]
  /** A reduced view some roles get (for example the desk sees headlines only). */
  limited?: readonly Permission[]
  /** The share-link viewer: not a signed-in role. It only ever sees what the patient chose to share. */
  shareViewer: Cell
}

export const MATRIX_ROWS: readonly RowDef[] = [
  { key: 'facts', full: ['ledger.read'], limited: ['ledger.headlines'], shareViewer: 'limited' },
  { key: 'original', full: ['document.view_content'], shareViewer: 'limited' },
  { key: 'upload', full: ['document.upload'], shareViewer: 'no' },
  { key: 'confirm', full: ['verify.records_tier', 'verify.clinician_tier'], shareViewer: 'no' },
  { key: 'seal', full: ['snapshot.seal'], shareViewer: 'no' },
  { key: 'share', full: ['share.manage'], shareViewer: 'no' },
  { key: 'consent', full: ['consent.manage_own', 'consent.record_assisted'], shareViewer: 'no' },
  { key: 'accesslog', full: ['access_log.read_own', 'audit.read'], shareViewer: 'no' },
  { key: 'admin', full: ['staff.manage', 'settings.manage'], shareViewer: 'no' },
]

export function matrixCell(role: MatrixRole, row: RowDef): Cell {
  if (role === 'share_viewer') return row.shareViewer
  const r = role as Role
  if (row.full.some((p) => can(r, p))) return 'yes'
  if (row.limited?.some((p) => can(r, p))) return 'limited'
  return 'no'
}

export const matrix = () => MATRIX_ROWS.map((row) => ({ key: row.key, cells: MATRIX_ROLES.map((r) => matrixCell(r, row)) }))
