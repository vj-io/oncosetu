// "Security & compliance" content: what OncoSetu has today against the HIPAA Security Rule safeguards, the DPDP Act 2023
// and ABDM. Every status below is taken from the code (the evidence column names where). We NEVER say "HIPAA compliant".
// Unknowns are blank "[ ]". Plain words for doctors and administrators.
export type Status = 'in_place' | 'partly' | 'planned'

export type Row = { area: string; today: string; status: Status; evidence: string }
export type Section = { id: 'hipaa' | 'dpdp' | 'abdm'; title: string; intro: string; rows: Row[] }

export const HEADLINE = "Built to HIPAA's safeguards. Formal HIPAA compliance (business associate agreements, a risk assessment and an independent audit) is on our roadmap."
export const NOT_CLAIMED = 'OncoSetu is not HIPAA compliant and is not certified under any scheme today. Everything below describes what is built, not a certificate.'
export const DEMO_NOTE = 'This deployment holds synthetic demonstration data only.'

export const STATUS_LABEL: Record<Status, string> = { in_place: 'In place', partly: 'Partly', planned: 'Planned' }

export const SECTIONS: Section[] = [
  {
    id: 'hipaa', title: 'HIPAA Security Rule safeguards', intro: 'The Security Rule groups its safeguards into administrative, physical and technical. This is where each one stands.',
    rows: [
      { area: 'Access control: who can open what', today: 'Eight role tiers. The desk sees headlines only; records staff and doctors see the record; administrators open a record only through logged break-glass access; auditors never open patient records. The same table is shown to patients.', status: 'in_place', evidence: 'src/server/rbac.ts, patients.ts (assertPatientAccess)' },
      { area: 'Minimum necessary', today: 'Each role gets only what its work needs. Share links show only what the patient chose to share, read-only, and expire.', status: 'in_place', evidence: 'role tiers, share links' },
      { area: 'Unique user IDs and multi-factor sign-in', today: 'Every staff member has their own account with a password and a one-time code from an authenticator app. Patients sign in with a one-time code sent to their phone.', status: 'in_place', evidence: 'staff login (TOTP), patient OTP' },
      { area: 'Automatic logoff', today: 'Sessions end after 30 minutes without activity (staff after 12 hours at most, patients after 2).', status: 'in_place', evidence: 'src/server/session.ts' },
      { area: 'Emergency access', today: 'Break-glass: a doctor or administrator gives a reason, access is time-limited, and the patient and the administrator are told.', status: 'in_place', evidence: 'break_glass table, /break-glass' },
      { area: 'Audit controls', today: 'Every access and change is written to an append-only log chained with hashes, so tampering shows. The log holds ids only, never names or document text.', status: 'in_place', evidence: 'src/server/audit.ts, Admin, Audit' },
      { area: 'Integrity of records', today: 'Facts need an exact quote from the source, files carry checksums, history is append-only, and sealed snapshots are digitally signed.', status: 'in_place', evidence: 'evidence gate, snapshots (Ed25519)' },
      { area: 'Encryption at rest', today: 'Names, phone numbers and every stored file are encrypted before they reach the database (AES-256-GCM, a key per file). Backups are encrypted with a separate key.', status: 'in_place', evidence: 'src/server/crypto.ts, backups' },
      { area: 'Transmission security', today: 'HTTPS only, with strict transport security, on the hosting platform. Documents are never given a public address.', status: 'in_place', evidence: 'src/proxy.ts headers' },
      { area: 'Contingency: backup and recovery', today: 'Daily encrypted backups kept 35 days, with a restore drill script. Erased patients stay in older backups until those expire.', status: 'partly', evidence: 'docs/RUNBOOK.md, scripts/restore-drill.ts' },
      { area: 'Breach notification', today: 'Detection is possible through the audit log. A written incident procedure exists in the runbook. A formal notification process with named owners is not set up.', status: 'partly', evidence: 'docs/RUNBOOK.md incident section' },
      { area: 'Business associate agreements (BAAs) with vendors', today: 'Hosting, database, SMS and AI providers are used under their standard terms. No BAAs have been signed.', status: 'planned', evidence: '[ ]' },
      { area: 'Risk assessment', today: 'A security review of the design exists. A formal, documented risk analysis has not been done.', status: 'planned', evidence: '[ ]' },
      { area: 'Workforce training and sanctions', today: 'No training programme or sanctions policy yet.', status: 'planned', evidence: '[ ]' },
      { area: 'Independent audit or certification', today: 'None yet.', status: 'planned', evidence: '[ ]' },
    ],
  },
  {
    id: 'dpdp', title: 'Digital Personal Data Protection Act, 2023 (India)', intro: 'The notice and consent screens are working drafts. Legal review is pending.',
    rows: [
      { area: 'Notice before consent', today: 'A privacy notice in English, Hindi and Hinglish, versioned. Each person acknowledges it and the version and time are recorded.', status: 'partly', evidence: 'Privacy & consent page (draft, legal review pending)' },
      { area: 'Consent for each purpose', today: 'Separate choices for care, second opinion, team discussion, AI-assisted reading and others. Off by default; a signed form with a PDF copy.', status: 'in_place', evidence: 'consents, signed_consents' },
      { area: 'Withdrawing consent', today: 'One tap for the patient. Checked on every use. Withdrawing stops sharing links at once. A signed withdrawal is also kept.', status: 'in_place', evidence: 'portal consent, FR-CON-04' },
      { area: 'Right to access and correction', today: 'Patients see their documents and who looked at their file, and can dispute a document. A formal request process is described in the notice.', status: 'partly', evidence: 'portal, dispute document' },
      { area: 'Right to erasure', today: 'After withdrawal a patient can ask for erasure. Records are removed after the hospital retention period; only a minimal record and the audit trail remain.', status: 'in_place', evidence: 'erase_patient() (drizzle 0006)' },
      { area: 'Children', today: 'For a patient under 18 a guardian signs.', status: 'in_place', evidence: 'signed consent rules' },
      { area: 'Grievance officer', today: 'The place is on the notice. The name and contact are blank until the hospital fills them in.', status: 'planned', evidence: 'Grievance officer: [ ]' },
      { area: 'Data Protection Officer', today: 'Not appointed.', status: 'planned', evidence: 'Data Protection Officer: [ ]' },
      { area: 'Breach notification to the Board and to patients', today: 'No process yet.', status: 'planned', evidence: '[ ]' },
      { area: 'Where the data is kept', today: 'Application and database run in Singapore today. Hosting in India is not set up.', status: 'partly', evidence: 'vercel.json (sin1), database region' },
    ],
  },
  {
    id: 'abdm', title: 'Ayushman Bharat Digital Mission (ABDM)', intro: 'ABHA-based record sharing, consent-first.',
    rows: [
      { area: 'Consent-based record pull', today: 'Records are requested only with the patient’s ABHA consent, shown as a document list with its source. Revoking removes everything brought in.', status: 'partly', evidence: 'src/server/abdm (simulated gateway)' },
      { area: 'Health information standards', today: 'Records arrive as FHIR bundles and are shown with their source. No facts are taken without a quote.', status: 'partly', evidence: 'src/core/fhir' },
      { area: 'Production registration and certification', today: 'The flow runs against an in-process simulated gateway. Registration as a health information user and sandbox certification are not done.', status: 'planned', evidence: '[ ]' },
    ],
  },
]

/** The counts shown as a summary strip. */
export function tally(): Record<Status, number> {
  const t: Record<Status, number> = { in_place: 0, partly: 0, planned: 0 }
  for (const s of SECTIONS) for (const r of s.rows) t[r.status]++
  return t
}
