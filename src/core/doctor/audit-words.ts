// Plain-language names for activity-log entries, so no screen prints a raw code such as "event.source_viewed". Pure.

const WORDS: Record<string, string> = {
  'document.view': 'Opened a document', // one row per viewing (30 minutes), not per page or scan image
  'document.upload': 'Document added',
  'document.duplicate_upload': 'Same file uploaded again (not added twice)',
  'document.quarantined': 'File set aside as unsafe or unsupported',
  'document.sanitised': 'Scripts or attached files removed from a PDF; the clean copy was kept',
  'document.processed': 'Document read by the system',
  'document.unreadable': 'Document could not be read',
  'document.identity_decision': 'A person decided whose document it is',
  'document.detach': 'Document taken out of the record',
  'document.tags': 'Document type changed by a person',
  'document.reprocess': 'Document read again',
  'document.marked_printed': 'Pages judged handwritten marked as printed and read',
  'document.manual_event': 'A person added a fact from a quote',
  'document.dispute': 'Patient disputed a document',
  'event.source_viewed': 'Opened the page behind a fact',
  'event.verify_bulk': 'Several facts marked as checked',
  'event.edit': 'A fact was corrected (original kept)',
  'event.dispute': 'A fact was disputed',
  'conflict.resolve': 'A disagreement between two sources was settled',
  'ledger.view': 'Opened what is new since the last visit',
  'snapshot.seal': 'Visit sealed',
  'snapshot.passport_print': 'Passport printed',
  'snapshot.download': 'Sealed visit downloaded for an offline check',
  'share.create': 'Share link created',
  'share.revoke': 'Share link switched off',
  'share.payload': 'Share link prepared',
  'share.locked': 'Share link locked after wrong passcodes',
  'request.create': 'Request letter created',
  'request.mark_sent': 'Request marked as given',
  'request.letter_print': 'Request letter printed',
  'request.reminder': 'Reminder sent to the patient',
  'request.withdraw': 'Request withdrawn',
  'request.unobtainable': 'Request closed: paper cannot be obtained',
  'request.settled': 'Request closed: paper received',
  'missing.transition': 'Missing-paper item updated',
  'statements.view': 'Read the patient’s own answers',
  'statements.submit': 'Patient gave answers before the visit',
  'consent.recorded': 'Consent recorded',
  'consent.withdrawn': 'Consent withdrawn',
  'consent.otp_requested': 'A code was sent for consent',
  'desk.lookup': 'Looked the patient up at the desk',
  'desk.verified': 'Patient identity confirmed at the desk',
  'desk.verify_failed': 'Identity check failed at the desk',
  'desk.otp_requested': 'A code was sent to the patient at the desk',
  'encounter.started': 'Visit started',
  'patient.registered': 'Patient registered',
  'patient.search': 'Searched for a patient',
  'patient.disclosure_changed': 'Whether the diagnosis may be discussed was changed',
  'patient.primary_contact_changed': 'Main contact changed',
  'patient.phone_changed': 'Patient’s mobile number added or changed',
  'patient.name_changed': 'Patient’s name changed',
  'patient.pre_visit_link_sent': 'Pre-visit link sent',
  'patient.token_issued': 'Records card issued',
  'patient.token_reissued': 'Records card replaced',
  'patient.token_revoked': 'Records card switched off',
  'break_glass.granted': 'Emergency access granted',
  'break_glass.reviewed': 'Emergency access reviewed',
  'access.refused': 'Access refused',
  'access.desk_reopen': 'Desk reopened today’s verified visit',
  'access.desk_reopen_refused': 'Desk reopen refused: needs a new code or witness',
  'caregiver.added': 'Family member added',
  'caregiver.revoked': 'Family member removed',
  'erasure.request': 'Erasure requested',
  'erasure.executed': 'Records erased',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'auth.sessions_revoked': 'Signed out other devices',
  'auth.patient_login': 'Patient signed in',
  'auth.otp_sent': 'Sign-in code sent',
  'auth.otp_failed': 'Wrong sign-in code',
  'auth.portal_password_set': 'Patient portal password chosen',
  'auth.portal_password_failed': 'Wrong patient portal password',
  'auth.signin_code_issued': 'Sign-in code shown at the desk',
  'auth.signin_code_limited': 'Sign-in code limit reached',
  'abdm.consent_denied': 'ABDM consent was denied', 'abdm.consent_expired': 'ABDM consent expired', 'abdm.consent_granted': 'ABDM consent was given', 'abdm.consent_revoked': 'ABDM consent was withdrawn',
  'abdm.erased': 'ABDM records erased', 'abdm.transfer_failed': 'ABDM transfer failed', 'abdm.transfer_refused': 'ABDM transfer refused',
  'audit.export': 'Activity log exported', 'audit.verify_chain': 'Whole log checked for changes', 'auth.demo_signin': 'Demo sign-in',
  'auth.otp_blocked': 'Sign-in code limit reached', 'auth.otp_limited': 'Sign-in code limit reached', 'capture.list': 'Capture list opened',
  'caregiver.revoke': 'Family member removed', 'consent.sign': 'Consent signed', 'consent.sign_withdraw': 'Consent withdrawn by signature',
  'consent.update': 'Consent changed', 'consent.withdraw': 'Consent withdrawn',
  'device.register': 'Capture device registered', 'device.revoke': 'Capture device switched off', 'device.wipe_ordered': 'Capture device wipe ordered',
  'document.attach': 'Document filed to the record', 'document.manual_event_rejected': 'A typed-in fact was refused', 'document.password_submitted': 'Password given for a locked PDF',
  'document.processing_aborted': 'Reading a document was stopped', 'document.upload_rejected': 'Upload refused (unsafe or unsupported file)',
  'encounter.audio_note_added': 'Voice note added', 'encounter.audio_note_played': 'Voice note played', 'encounter.started_offline': 'Visit started offline',
  'erasure.cancel': 'Erasure request cancelled', 'id_verification.record': 'Identity check recorded', 'identity.full_id_rejected': 'Full ID number refused', 'identity.id_invalid': 'ID number not valid',
  'inbound.alias_created': 'Email address for records created', 'inbound.alias_rotated': 'Email address for records changed', 'inbound.contact_email_added': 'Sender email added', 'inbound.contact_email_revoked': 'Sender email removed',
  'inbound.email_received': 'Email with records received', 'inbound.email_rejected': 'Email with records refused', 'inbound.hold_code_wrong': 'Wrong code for a held message', 'inbound.hold_discarded': 'Held message discarded',
  'inbound.hold_expired': 'Held message expired', 'inbound.hold_released': 'Held message released', 'inbound.whatsapp_held': 'WhatsApp message held', 'inbound.whatsapp_rejected': 'WhatsApp message refused',
  'measurement.export': 'Consultation study exported', 'measurement.requests_export': 'Request outcomes exported', 'measurement.submit': 'Consultation form filled in',
  'patient.control_transferred': 'Control of the record moved', 'patient.deceased_set': 'Patient recorded as deceased', 'patient.duplicate_check': 'Duplicate patients checked',
  'patient.merge_approve': 'Merge of two records approved', 'patient.merge_execute': 'Two records merged', 'patient.merge_reject': 'Merge of two records refused', 'patient.merge_request': 'Merge of two records requested',
  'perf_probe.run': 'Speed check run', 'privacy.acknowledge': 'Privacy notice acknowledged', 'request.patient_letter': 'Patient made a request letter',
  'rule.mark_reviewed': 'Missing-papers check reviewed', 'rule.return_to_shadow': 'Missing-papers check sent back to review',
  'settings.demo_clock': 'Demo clock moved', 'settings.flags': 'Hospital switches changed', 'settings.llm_budget': 'Daily text allowance changed', 'settings.questions': 'Study questions changed', 'settings.retention': 'Retention period changed',
  'staff.create': 'Staff account created', 'staff.deactivate': 'Staff account switched off', 'staff.reactivate': 'Staff account switched on', 'staff.role_change': 'Staff role changed', 'staff.totp_reset': 'Authenticator reset',
  'statement.audio_played': 'Patient voice answer played', 'upload.chunked_finish': 'Large upload finished', 'upload.chunked_start': 'Large upload started',
  'verification.qa_review': 'Reading accuracy review', 'voice.readback': 'Voice read-back played', 'voice.transcribed': 'Voice note turned into text',
  'abdm.consent_requested': 'Records requested from other hospitals through ABDM',
  'abdm.transfer_received': 'Records received through ABDM',
}

/** A plain name for an action code. Unknown codes become lower-case words, never the raw code. */
export function describeAction(action: string): string {
  if (WORDS[action]) return WORDS[action]
  const t = action.replace(/[._]+/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Activity'
}

/** What kind of thing an entry was about, in words. */
const TARGETS: Record<string, string> = {
  patient: 'Patient record', document: 'Document', event: 'Fact', snapshot: 'Sealed visit', share_link: 'Share link', record_request: 'Request letter',
  missing_record: 'Missing paper', audit_log: 'Activity log', org_settings: 'Hospital settings', rule: 'Missing-papers check', device: 'Capture device', document_link: 'Document link', audit: 'Activity log', session: 'Sign-in session', staff: 'Staff account', caregiver: 'Family member', encounter: 'Visit', erasure_request: 'Erasure request',
}
export const describeTarget = (t: string | null) => {
  if (!t) return '—'
  if (TARGETS[t]) return TARGETS[t]
  const w = t.replace(/_/g, ' ')
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** Detail keys in words. Ids are shortened; a patient id becomes its record code, so a row can be traced without a raw uuid. */
const DETAIL_KEYS: Record<string, string> = { patientId: 'Record', lang: 'Language', hours: 'Hours', patientNotified: 'Patient told', reason: 'Reason', rows: 'Rows', truncated: 'Cut short', role: 'Role', fallback: 'Auditor fallback', reviewerRole: 'Reviewed by' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function describeDetails(details: Record<string, unknown>, code: (uuid: string) => string): { key: string; value: string }[] {
  return Object.entries(details).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => {
    const key = DETAIL_KEYS[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())
    const value = typeof v === 'string' ? (UUID_RE.test(v) ? (k === 'patientId' ? code(v) : v.replace(/-/g, '').slice(-8)) : v)
      : typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return { key, value }
  })
}
