// Plain-language wording for access-log rows (the raw action codes stay in the audit log; people read these).
const BY_ACTION: Record<string, string> = {
  'document.view': 'Opened a document', 'document.upload': 'Added a document', 'document.duplicate_upload': 'A document that was already here was sent again',
  'event.source_viewed': 'Looked at a fact and its source', 'share.payload': 'Prepared a share link', 'share.create': 'Made a share link', 'share.view': 'A share link was opened',
  'share.revoke': 'Switched off a share link', 'snapshot.seal': 'Signed and sealed the record', 'snapshot.export': 'Exported the record', 'desk.verified': 'The front desk confirmed who the patient is',
  'break_glass.request': 'Emergency (break-glass) access was used', 'consent.sign': 'The consent form was signed', 'consent.sign_withdraw': 'A withdrawal of consent was signed',
  'consent.update': 'Consent choices were changed', 'consent.withdraw': 'Consent was withdrawn', 'privacy.acknowledge': 'The privacy notice was acknowledged',
  'id_verification.record': 'An ID check was recorded', 'auth.patient_login': 'Signed in', 'auth.demo_signin': 'Signed in (demo)', 'upload.chunked_finish': 'Added a large file',
}

export function accessPhrase(action: string, targetType: string | null): string {
  if (BY_ACTION[action]) return BY_ACTION[action]
  const verb = action.split('.').pop() ?? action
  const what = targetType ? targetType.replace(/_/g, ' ') : 'the file'
  return `${verb.replace(/_/g, ' ')} (${what})`.replace(/^./, (c) => c.toUpperCase())
}
