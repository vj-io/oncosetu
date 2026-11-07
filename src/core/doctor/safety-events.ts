// "Blocked and held" events in plain words (admin and auditor view). Pure: turns audit rows and a few table flags into
// sentences a doctor can read. No event codes reach the screen, and no patient names or document text.

export const SAFETY_KINDS = [
  'wrong_patient', 'hidden_instructions', 'handwriting', 'role_refused', 'no_consent', 'break_glass', 'share_refused',
  'sms_limit', 'id_number_rejected', 'upload_rejected', 'duplicate_upload', 'consent_withdrawn', 'erasure_done',
] as const
export type SafetyKind = (typeof SAFETY_KINDS)[number]

export type SafetyTone = 'conflict' | 'unverified' | 'setu' | 'neutral' | 'verified'

export const SAFETY_META: Record<SafetyKind, { label: string; tone: SafetyTone; explain: string }> = {
  wrong_patient: { label: 'Wrong-patient report held', tone: 'conflict', explain: 'A report whose name or details did not match this patient was kept out of the record until a person decides.' },
  hidden_instructions: { label: 'Hidden instructions removed', tone: 'conflict', explain: 'A document carried invisible text trying to give the software orders. It was ignored and flagged for staff.' },
  handwriting: { label: 'Handwriting kept as an image', tone: 'unverified', explain: 'A handwritten page is shown as the original picture only. The software does not guess at handwriting.' },
  role_refused: { label: 'Refused by role', tone: 'conflict', explain: 'Someone tried to open a page their job role does not allow.' },
  no_consent: { label: 'Refused: no consent or ID check', tone: 'conflict', explain: 'A record was not opened because the patient had not consented or had not been verified.' },
  break_glass: { label: 'Emergency access used', tone: 'conflict', explain: 'A clinician opened a record without consent, giving a reason. The patient is told and the reason is kept.' },
  share_refused: { label: 'Share link refused', tone: 'unverified', explain: 'Someone opened a share link with the wrong passcode, after it expired, or after it was switched off.' },
  sms_limit: { label: 'Code limit reached', tone: 'unverified', explain: 'A phone asked for too many verification codes, so no further code was sent for a while.' },
  id_number_rejected: { label: 'Full ID number rejected', tone: 'unverified', explain: 'A full government ID number was typed where it must not be stored, and was refused.' },
  upload_rejected: { label: 'Upload rejected (unsafe or unsupported file)', tone: 'unverified', explain: 'A file was refused because it looked unsafe or was in a format the system cannot read.' },
  duplicate_upload: { label: 'Duplicate upload', tone: 'neutral', explain: 'The same file was uploaded twice. The copy was recognised and not added again.' },
  consent_withdrawn: { label: 'Consent withdrawn', tone: 'setu', explain: 'A patient withdrew consent. Access and share links stopped.' },
  erasure_done: { label: 'Records erased', tone: 'verified', explain: 'A patient’s records were erased at their request. The audit trail is kept.' },
}

export type RawSafety = {
  source: 'audit' | 'share_view' | 'document'
  at: Date
  action?: string
  details?: Record<string, unknown>
  actorRole?: string | null
  actorName?: string | null
  outcome?: string // share_view
  doc?: { identityResult: string; handwritten: boolean | null; injectionFlag: boolean }
  patientId: string | null
  reason?: string | null // break-glass reason, joined by the loader
}

export type SafetyEvent = { kind: SafetyKind; at: Date; title: string; detail: string; who: string; patientId: string | null }

const ROLE_WORDS: Record<string, string> = { desk: 'Desk staff', records: 'Records staff', clinician: 'Clinician', org_admin: 'Administrator', auditor: 'Auditor', patient: 'Patient', caregiver: 'Caregiver', system: 'The system' }
export const roleWords = (r: string | null | undefined) => (r ? ROLE_WORDS[r] ?? 'Someone' : 'Someone')
const whoOf = (r: RawSafety) => (r.actorName ? `${r.actorName} (${roleWords(r.actorRole).toLowerCase()})` : roleWords(r.actorRole))

const REJECT_WORDS: Record<string, string> = {
  unsupported_type: 'The file type is not one the system accepts.', file_too_large: 'The file was over the size limit.', malware_signature: 'The file carried a known test-virus signature.',
  empty_file: 'The file was empty.', zip_bomb: 'A ZIP expanded far too much and was refused.', zip_too_many_files: 'A ZIP held too many files.', zip_too_large: 'A ZIP was over the size limit.',
  zip_too_big_unpacked: 'A ZIP was too large once opened.', zip_unreadable: 'A ZIP could not be opened.', zip_empty: 'A ZIP was empty.', unsafe_file_name: 'A ZIP held files with unsafe paths. They were refused.',
  nested_archive: 'A ZIP held another ZIP. It was refused.', zip_nothing_accepted: 'Nothing in a ZIP could be accepted.',
}

const SHARE: Record<string, string> = {
  wrong_passcode: 'a wrong passcode was typed', locked: 'the link is locked after too many wrong passcodes', expired: 'the link had expired',
  revoked: 'the link had been switched off', unavailable: 'the patient had withdrawn consent',
}

/** One raw row to zero or one plain-language event. Unrelated audit rows return null. */
export function describeSafety(r: RawSafety): SafetyEvent | null {
  const mk = (kind: SafetyKind, detail: string, who = whoOf(r)): SafetyEvent => ({ kind, at: r.at, title: SAFETY_META[kind].label, detail, who, patientId: r.patientId })
  if (r.source === 'share_view') {
    if (!r.outcome || r.outcome === 'viewed') return null
    return mk('share_refused', `The link was not opened: ${SHARE[r.outcome] ?? 'the check failed'}.`, 'Someone with the link')
  }
  if (r.source === 'document') {
    const d = r.doc
    if (!d) return null
    if (d.identityResult === 'mismatch') return mk('wrong_patient', 'Name and details on the report differ from this patient. Nothing from it entered the record.', 'The system')
    if (d.injectionFlag) return mk('hidden_instructions', 'Invisible instructions in the document were ignored. No fact was taken from them.', 'The system')
    if (d.handwritten) return mk('handwriting', 'Kept as the original image. No text was read from it.', 'The system')
    return null
  }
  const a = r.action ?? ''
  const d = r.details ?? {}
  switch (a) {
    case 'access.refused': {
      const why = String(d.reason ?? '')
      if (why === 'forbidden' || why === 'break_glass_required') return mk('role_refused', `${roleWords(r.actorRole)} accounts cannot open patient records${why === 'break_glass_required' ? ' without emergency access' : ''}.`)
      return mk('no_consent', why === 'verification_required' ? 'The patient or contact had not yet confirmed a code at the desk.' : 'There was no active consent for this patient.')
    }
    case 'break_glass.granted': return mk('break_glass', r.reason ? `Reason given: “${r.reason}”` : 'A reason was recorded.')
    case 'share.locked': return mk('share_refused', 'The link was locked: too many wrong passcodes.', 'Someone with the link')
    case 'auth.otp_blocked': case 'auth.otp_limited': return mk('sms_limit', 'No sign-in code was sent: this phone has reached its limit of codes for now.')
    case 'desk.otp_requested': case 'consent.otp_requested':
      return d.outcome === 'locked' ? mk('sms_limit', 'No new code was sent: this phone has reached its limit. Use in-person witnessed check-in instead.') : null
    case 'desk.verify_failed': return d.reason === 'locked' ? mk('sms_limit', 'Too many wrong codes were typed, so this phone is paused for a while.') : null
    case 'identity.full_id_rejected': return mk('id_number_rejected', 'A full ID number was refused. Only the last four digits may be kept.')
    case 'document.upload_rejected': return mk('upload_rejected', REJECT_WORDS[String(d.reason ?? '')] ?? 'The file was refused and nothing was kept.')
    case 'document.quarantined': return mk('upload_rejected', 'The file looked unsafe or unsupported and was set aside. It was never opened.')
    case 'inbound.email_rejected': return mk('upload_rejected', 'An emailed attachment was refused.', 'The system')
    case 'document.unreadable': return mk('upload_rejected', 'The file could not be read, so it was not processed.', 'The system')
    case 'document.duplicate_upload': return mk('duplicate_upload', 'The same file was already on record, so no second copy was added.')
    case 'consent.withdrawn': case 'consent.sign_withdraw': case 'consent.withdraw': return mk('consent_withdrawn', 'Access and share links for this patient have stopped.')
    case 'erasure.executed': return mk('erasure_done', 'The patient’s records were removed. The audit trail remains.', 'The system')
    default: return null
  }
}

/** The audit actions the loader must fetch. Kept next to the mapper so they cannot drift apart. */
export const SAFETY_AUDIT_ACTIONS = [
  'access.refused', 'break_glass.granted', 'share.locked', 'desk.otp_requested', 'consent.otp_requested', 'desk.verify_failed',
  'identity.full_id_rejected', 'document.upload_rejected', 'document.quarantined', 'inbound.email_rejected', 'document.unreadable', 'document.duplicate_upload',
  'consent.withdrawn', 'consent.sign_withdraw', 'consent.withdraw', 'auth.otp_blocked', 'auth.otp_limited', 'erasure.executed',
] as const

export function tally(events: readonly Pick<SafetyEvent, 'kind'>[]): Record<SafetyKind, number> {
  const out = Object.fromEntries(SAFETY_KINDS.map((k) => [k, 0])) as Record<SafetyKind, number>
  for (const e of events) out[e.kind]++
  return out
}
