// Role → permission matrix (PRD §6.1). Server-side checks only; the UI may mirror them for display.
export type Role = 'patient' | 'caregiver' | 'desk' | 'records' | 'clinician' | 'org_admin' | 'auditor' | 'system'
export type StaffRole = Extract<Role, 'desk' | 'records' | 'clinician' | 'org_admin' | 'auditor'>
export const STAFF_ROLES: readonly StaffRole[] = ['desk', 'records', 'clinician', 'org_admin', 'auditor']

const PATIENT_SIDE: Role[] = ['patient', 'caregiver']

export const PERMISSIONS = {
  // identity, registration, consent
  'patient.read_own': PATIENT_SIDE,
  'patient.lookup': ['desk', 'records', 'clinician'],
  'patient.register': ['desk', 'records'],
  'patient.token_revoke': [...PATIENT_SIDE, 'desk', 'records'],
  'patient.merge_request': ['records'],
  'patient.merge_approve': ['records', 'org_admin'],
  'patient.set_deceased': ['records', 'clinician'],
  'disclosure.set': ['clinician'],
  'consent.manage_own': PATIENT_SIDE,
  'consent.record_assisted': ['desk', 'records'],
  'caregiver.manage': ['patient', 'desk', 'records'], // a caregiver cannot grant itself scope
  'access_log.read_own': PATIENT_SIDE,
  'break_glass.request': ['clinician', 'org_admin'],
  // capture and documents
  'encounter.start': ['desk', 'records', 'clinician'],
  'document.upload': [...PATIENT_SIDE, 'desk', 'records', 'clinician'],
  'document.attach': ['desk', 'records'],
  'document.detach': ['records', 'clinician'],
  'document.view_content': [...PATIENT_SIDE, 'records', 'clinician'],
  'duplicate.resolve': ['records'],
  'statement.capture': [...PATIENT_SIDE, 'desk'],
  'statement.confirm': PATIENT_SIDE,
  'onboarding.run': ['records'],
  // record, verification, snapshots
  'ledger.headlines': ['desk', 'records', 'clinician'],
  'ledger.read': [...PATIENT_SIDE, 'records', 'clinician'],
  'evidence.read': [...PATIENT_SIDE, 'records', 'clinician'],
  'verify.records_tier': ['records', 'clinician'],
  'verify.clinician_tier': ['clinician'],
  'event.dispute': [...PATIENT_SIDE, 'clinician'],
  'conflict.resolve': ['clinician'],
  'snapshot.seal': ['clinician'],
  // radar, requests, sharing
  'radar.read': [...PATIENT_SIDE, 'records', 'clinician'],
  'radar.update': ['records', 'clinician'],
  'request.manage': [...PATIENT_SIDE, 'records'],
  'share.manage': PATIENT_SIDE,
  // admin, audit, metrics
  'staff.manage': ['org_admin'],
  'device.manage': ['org_admin'],
  'rules.manage': ['org_admin'],
  'retention.manage': ['org_admin'],
  'settings.manage': ['org_admin'],
  'audit.read': ['org_admin', 'auditor'],
  'audit.export': ['org_admin', 'auditor'],
  'metrics.read': ['org_admin', 'auditor'],
  'measurement.submit': ['clinician'],
  // background work
  'pipeline.run': ['system'],
  'radar.run': ['system'],
  'snapshot.sign': ['system'],
} as const satisfies Record<string, readonly Role[]>

export type Permission = keyof typeof PERMISSIONS

export function can(role: Role, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly Role[]).includes(role)
}
