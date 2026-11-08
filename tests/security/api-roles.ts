// Who may call each API handler (PRD §6.1 roles, §10.2 "every role × every endpoint"). One entry per exported handler of
// src/app/api/**/route.ts; tests/security/rbac-endpoints.test.ts fails when a handler has no entry, an entry has no
// handler, or route()'s guard differs from the entry, and tests/e2e/rbac-sweep.spec.ts calls every handler as every role.
//
// A string entry is the policy and also exactly what route() enforces: space-separated roles, or 'public' (no session).
// An object entry is a handler whose route() gate is wider than the policy and is narrowed inside the handler:
//   roles = the policy, gate = what route() lets through ('any' = every signed-in role), check = the narrowing code,
//   which must appear in `in` (default: the route file). A public handler with a `check` needs a secret or signature.
export type Expect = string | { roles: string; gate: string; check: string; in?: string }

const FRONT = 'desk records clinician'
const CLINICAL = 'records clinician'
const FAMILY = 'patient caregiver'
const AUDIT = 'org_admin auditor'
const cron = { roles: 'public', gate: 'public', check: 'CRON_SECRET' }
const requestManage = { roles: `${CLINICAL} ${FAMILY}`, gate: 'any', check: "can(sessionRole(s), 'request.manage')", in: 'src/server/requests/requests.ts' }
const originals = { roles: `${CLINICAL} ${FAMILY}`, gate: 'any', check: "ctx.session.kind === 'staff' && !['records', 'clinician'].includes(ctx.session.role)" }

export const EXPECTED: Record<string, Expect> = {
  // admin, audit, metrics
  'GET /api/admin/audit.csv': AUDIT,
  'POST /api/admin/audit/verify': AUDIT,
  'POST /api/admin/break-glass/[id]/review': 'org_admin',
  'POST /api/admin/duplicates': 'records org_admin',
  'POST /api/admin/duplicates/[id]': 'records org_admin',
  'POST /api/admin/erasure/[id]/execute': 'org_admin',
  'POST /api/admin/erasure/run-due': 'org_admin',
  'POST /api/admin/metrics/qa': 'clinician',
  'POST /api/admin/rules/[ruleId]': 'org_admin',
  'POST /api/admin/settings': 'org_admin',
  'POST /api/admin/settings/demo-clock': 'org_admin',
  'POST /api/admin/staff': 'org_admin',
  'POST /api/admin/staff/[id]': 'org_admin',
  'GET /api/measure/export.csv': AUDIT,
  'GET /api/measure/requests.csv': AUDIT,
  'POST /api/measure/forms': 'clinician',
  // sign-in
  'GET /api/auth/demo-accounts': 'public',
  'POST /api/auth/logout': 'public',
  'GET /api/auth/me': `${FRONT} ${AUDIT} ${FAMILY}`,
  'GET /api/auth/sessions': `${FRONT} ${AUDIT}`,
  'POST /api/auth/sessions/revoke-others': `${FRONT} ${AUDIT}`,
  'POST /api/auth/patient/demo-code': 'public',
  'POST /api/auth/patient/otp/start': 'public',
  'POST /api/auth/patient/otp/verify': 'public',
  'POST /api/auth/staff/login': 'public',
  // machine callers: Vercel Cron (bearer CRON_SECRET), Postmark (basic auth), Twilio (request signature)
  'GET /api/cron/abdm-erase': cron,
  'GET /api/cron/backup': cron,
  'GET /api/cron/erasure': cron,
  'GET /api/cron/inbound-holds': cron,
  'GET /api/cron/llm-health': cron,
  'GET /api/cron/outbox': cron,
  'GET /api/cron/perf-probe': cron,
  'GET /api/cron/requests': cron,
  'POST /api/inbound/email': { roles: 'public', gate: 'public', check: 'basicAuthOk(' },
  'POST /api/inbound/whatsapp': { roles: 'public', gate: 'public', check: 'validTwilioSignature(' },
  // public by design: demo outbox (demo orgs only), signing keys, seal verification, share links (key + passcode)
  'GET /api/demo/outbox': 'public',
  'GET /api/keys': 'public',
  'GET /api/snapshots/[id]/verify': 'public',
  'POST /api/shares/[id]/open': 'public',
  'POST /api/shares/verify-payload': 'public',
  // desk
  'POST /api/desk/consent-otp': FRONT,
  'POST /api/desk/duplicate-check': FRONT,
  'POST /api/desk/lookup': FRONT,
  'POST /api/desk/verify/code': FRONT,
  'POST /api/desk/verify/start': FRONT,
  'POST /api/desk/verify/witnessed': FRONT,
  // capture devices
  'POST /api/devices/[id]/revoke': 'org_admin',
  'GET /api/devices/capture-list': FRONT,
  'POST /api/devices/register': `${FRONT} org_admin`,
  'GET /api/devices/status': `${FRONT} ${AUDIT}`,
  // documents and ledger items
  'POST /api/documents/[id]/attach': CLINICAL, // rbac 'document.identity_decision' (FR-ID-05), not 'document.attach'
  'POST /api/documents/[id]/detach': CLINICAL,
  'GET /api/documents/[id]/file': originals,
  'GET /api/documents/[id]/preview': originals,
  'POST /api/documents/[id]/manual-events': CLINICAL,
  'POST /api/documents/[id]/password': FRONT,
  'POST /api/documents/[id]/reprocess': CLINICAL,
  'GET /api/documents/[id]/status': FRONT,
  'POST /api/documents/[id]/tags': CLINICAL,
  'POST /api/events/[id]/resolve': 'clinician',
  'POST /api/events/[id]/verify': CLINICAL,
  'POST /api/events/[id]/viewed': CLINICAL,
  'POST /api/missing/[id]/transition': CLINICAL,
  'GET /api/snapshots/[id]': CLINICAL,
  'GET /api/signed-consents/[id]/pdf': { roles: `${FRONT} ${FAMILY}`, gate: 'any', check: "ctx.session.kind === 'staff' && !['desk', 'records', 'clinician'].includes(ctx.session.role)" },
  // patient portal
  'POST /api/p/abdm/[requestId]': FAMILY,
  'POST /api/p/caregivers/[id]/revoke': { roles: 'patient', gate: FAMILY, check: "session.kind !== 'patient'" },
  'POST /api/p/card/revoke': FAMILY,
  'POST /api/p/consent': FAMILY,
  'POST /api/p/consent/sign': FAMILY,
  'POST /api/p/documents': FAMILY,
  'POST /api/p/documents/[id]/dispute': FAMILY,
  'POST /api/p/erasure': FAMILY,
  'POST /api/p/privacy': FAMILY,
  'GET /api/p/requests': FAMILY,
  'GET /api/p/share-payload': FAMILY,
  'POST /api/p/statements': FAMILY,
  'POST /api/p/uploads': FAMILY,
  'GET /api/p/uploads/[sid]': FAMILY,
  'POST /api/p/uploads/[sid]': FAMILY,
  'POST /api/p/uploads/[sid]/finish': FAMILY,
  'POST /api/p/voice/readback': FAMILY,
  'POST /api/p/voice/transcribe': FAMILY,
  // patient workspace (staff)
  'GET /api/patients': FRONT,
  'POST /api/patients': FRONT,
  'GET /api/patients/[id]/abdm': CLINICAL,
  'POST /api/patients/[id]/abdm/consent-requests': CLINICAL,
  'POST /api/patients/[id]/audio-notes': FRONT,
  'GET /api/patients/[id]/audio-notes/[clipId]': CLINICAL,
  'POST /api/patients/[id]/break-glass': 'clinician org_admin',
  'POST /api/patients/[id]/caregivers': FRONT,
  'POST /api/patients/[id]/caregivers/[caregiverId]/revoke': FRONT,
  'POST /api/patients/[id]/consent': FRONT,
  'POST /api/patients/[id]/consent/deceased': CLINICAL,
  'POST /api/patients/[id]/consent/otp': FRONT,
  'POST /api/patients/[id]/consent/primary-contact': FRONT,
  'POST /api/patients/[id]/consent/sign': FRONT,
  'POST /api/patients/[id]/consent/transfer-control': FRONT,
  'POST /api/patients/[id]/contact-emails': FRONT,
  'POST /api/patients/[id]/contact-emails/[contactId]/revoke': FRONT,
  'POST /api/patients/[id]/disclosure': 'clinician',
  'GET /api/patients/[id]/documents': FRONT,
  'POST /api/patients/[id]/encounters': CLINICAL,
  'POST /api/patients/[id]/documents': FRONT,
  'POST /api/patients/[id]/erasure': CLINICAL,
  'POST /api/patients/[id]/id-verification': FRONT,
  'POST /api/patients/[id]/inbound-alias': FRONT,
  'POST /api/patients/[id]/pre-visit-link': FRONT,
  'POST /api/patients/[id]/seal': 'clinician',
  'GET /api/patients/[id]/share-payload': FRONT,
  'GET /api/patients/[id]/snapshots': CLINICAL,
  'GET /api/patients/[id]/statements/[sid]/audio': CLINICAL,
  'POST /api/patients/[id]/token': 'desk records',
  'POST /api/patients/[id]/uploads': FRONT,
  'GET /api/patients/[id]/uploads/[sid]': FRONT,
  'POST /api/patients/[id]/uploads/[sid]': FRONT,
  'POST /api/patients/[id]/uploads/[sid]/finish': FRONT,
  'POST /api/patients/[id]/verify-bulk': CLINICAL,
  // records requests and shares
  'GET /api/requests': FRONT, // rbac 'request.view'; changing a request is 'request.manage'
  'POST /api/requests': requestManage,
  'POST /api/requests/[id]/sent': requestManage,
  'POST /api/requests/[id]/unobtainable': requestManage,
  'POST /api/requests/[id]/withdraw': requestManage,
  'POST /api/shares': `${FRONT} ${FAMILY}`,
  'POST /api/shares/[id]/revoke': `${FRONT} ${FAMILY}`,
}

/** The roles an entry allows, or 'public'. */
export const policyOf = (e: Expect): string[] | 'public' => {
  const s = typeof e === 'string' ? e : e.roles
  return s === 'public' ? 'public' : s.split(' ')
}
