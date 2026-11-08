# OWASP ASVS Level 2: self-assessment

PRD §10.2 asks for an OWASP ASVS Level 2 checklist reviewed before v1.0. This is the team's own reading of the code
on 8 November 2026 against **ASVS 4.0.3, Level 2**. **It is not an external review and claims no certification.** An
independent security review (and a penetration test of the deployed system) is still required before a pilot with real
patients. Every "met" below points at the code or the test that shows it; nothing here was confirmed by a third party.

Status: **met** (evidence in code and, where noted, a test) · **partly** (some of it, or only on the deployed host) ·
**not met** · **n.a.** (the feature does not exist here). Requirements that only apply at Level 3 are left out.

Summary: 144 rows — 96 met, 31 partly, 10 not met, 7 n.a. The not-met items are listed at the end with
the change each needs.

## V1 Architecture, design and threat modelling

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 1.1.2 | Threat model for design changes | partly | STRIDE table in PRD §10.1; no per-change threat review is recorded |
| 1.1.4 | Trust boundaries and data flows documented | partly | docs/ARCHITECTURE.md request pipeline; no data-flow diagram per boundary |
| 1.4.1 | Access control enforced at trusted points | met | Every API handler goes through `route()` (src/server/http.ts); pages through `requireStaff()` / `requirePatientSession()` |
| 1.4.4 | One vetted access-control mechanism | met | `route()` roles + `assertPatientAccess` + Postgres RLS (drizzle/0001_rls_roles.sql) |
| 1.4.5 | Attribute/feature-based access control | met | Consent purposes checked on use, verified desk encounter, break-glass, disclosure (src/server/patients.ts) |
| 1.5.3 | Input validation on a trusted layer | met | zod schemas in `route()` options for every body and query |
| 1.6.1 | Explicit key-management policy | partly | Keys and rotation in docs/RUNBOOK.md; keys live in environment variables, not a KMS (PRD §10.2 asks for one) |
| 1.7.1 | Common logging format | met | JSON lines from src/server/log.ts; append-only, hash-chained audit_log (src/server/audit.ts) |
| 1.8.1 | Sensitive data identified and classified | partly | PRD §7 marks PII columns (`*_enc`); no separate data classification document |
| 1.9.1 | Encrypted connections between components | met | Neon over TLS; Vercel Blob, Twilio, ABDM, LLM providers over HTTPS |
| 1.12.2 | User files served so they cannot run as active content | met | /api/documents/[id]/file sends `sandbox; default-src 'none'` CSP and nosniff (src/proxy.ts); asserted in tests/e2e/security-headers.spec.ts |
| 1.14.3 | Dependency checks in the build | met | .github/workflows/ci.yml: `npm audit --audit-level=high`, gitleaks, Semgrep (not yet run on GitHub at the time of writing) |
| 1.14.4 | Repeatable build and deployment | partly | Vercel builds from git; CI added 8 Nov 2026; no signed release artefacts |

## V2 Authentication

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 2.1.1 | Passwords at least 12 characters | partly | Staff created by an admin need 12+ (src/app/api/admin/staff/route.ts); the seeded demo accounts share a 9-character password (scripts/seed-base.ts) and must not exist in a pilot |
| 2.1.2 | Passwords of 64+ characters allowed | met | Up to 200 characters accepted |
| 2.1.7 | Passwords checked against breached lists | not met | No breached-password check |
| 2.1.9 | No composition rules | met | Length rule only |
| 2.2.1 | Anti-automation on authentication | met | 5 failed staff logins lock the account 15 min (src/app/api/auth/staff/login/route.ts); patient OTP: 3 sends per 10 min, 10 per day, 5 wrong codes lock 15 min (src/server/otp.ts, unit tests in otp.test.ts) |
| 2.2.2 | Weak authenticators (SMS) limited | partly | SMS OTP is the patient's only factor (phones are what patients have); staff use password + TOTP |
| 2.2.3 | Notification after authentication details change | not met | No notice when a staff password or TOTP changes |
| 2.4.1 | Passwords stored with a salted, approved KDF | met | scrypt N=2^15, r=8, p=1 (src/server/crypto.ts); unit test crypto.test.ts |
| 2.4.2 | Salt at least 32 bits | met | 128-bit random salt per password |
| 2.5.x | Credential recovery | n.a. | No self-service recovery: an administrator resets a staff account |
| 2.7.2 | Out-of-band codes expire in 10 minutes or less | met | Patient OTP expires after 5 minutes |
| 2.7.3 | Out-of-band codes used once | met | Challenge consumed on success (src/server/otp.ts) |
| 2.7.4 | Out-of-band channel separate | met | Code sent by SMS, entered in the browser |
| 2.7.6 | Out-of-band code from a CSPRNG, 20+ bits | met | `crypto.randomInt` six digits (~20 bits) |
| 2.8.1 | Time-based OTP has a defined lifetime | met | RFC 6238, 30 s step, ±1 step (src/server/totp.ts, totp.test.ts) |
| 2.8.3 | Approved algorithms for OTP | met | HMAC-SHA1 TOTP per RFC 6238 |
| 2.8.4 | TOTP usable once within its validity period | not met | No record of the last accepted step: a code can be replayed within ~90 s |
| 2.10.1 | Service authentication without default credentials | met | Cron: `Bearer CRON_SECRET`, timing-safe compare; Postmark: basic auth; Twilio: request signature |
| 2.10.4 | Service secrets not in source | met | Environment variables; gitleaks over full history in CI (.gitleaksignore lists reviewed false positives) |
| — | Multi-factor for staff | partly | TOTP is checked when `staff.totp_enabled` is set; an account without it signs in with a password alone (login route line `!s.totpEnabled \|\| …`) |

## V3 Session management

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 3.1.1 | No session token in URLs | met | Cookie only |
| 3.2.1 | New token on sign-in | met | `createSession` issues a fresh 32-byte token per login (src/server/session.ts) |
| 3.2.2 | Token entropy 64+ bits | met | 256 bits; only its SHA-256 is stored |
| 3.2.3 | Token stored securely in the browser | met | HttpOnly cookie; asserted in tests/e2e/security-headers.spec.ts |
| 3.3.1 | Logout invalidates the session | met | Row revoked and cookie cleared (`destroySession`); asserted (me → 401 after sign-out) |
| 3.3.2 | Idle and absolute timeouts | met | Staff 12 h / 30 min idle; patients 2 h / 30 min; desk station 30 / 5 min |
| 3.3.3 | Option to end other sessions after a credential change | not met | |
| 3.3.4 | Users can see and end their active sessions | not met | |
| 3.4.1 | Cookie `Secure` | met | Set on every deployed host; dropped only for plain-http localhost (`cookieSecure`, src/server/session.test.ts) |
| 3.4.2 | Cookie `HttpOnly` | met | security-headers.spec.ts |
| 3.4.3 | Cookie `SameSite` | met | `Lax`; security-headers.spec.ts |
| 3.4.4 | `__Host-` cookie prefix | not met | Cookie is `os_sid`; host-only (no Domain), Path=/, so the prefix could be added |
| 3.4.5 | Cookie path precise | met | One app per host, Path=/ |
| 3.5.x | Token-based sessions | n.a. | No JWTs or bearer tokens for users |
| 3.7.1 | Re-authentication for sensitive actions | partly | Break-glass needs a written reason and expires in 4 h; consent changes need patient OTP or a witness; no password re-entry |

## V4 Access control

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 4.1.1 | Enforced on a trusted service layer | met | `route()`; RBAC table tests/security/api-roles.ts |
| 4.1.2 | Access-control data not changeable by users | met | Session and role read from the database per request |
| 4.1.3 | Least privilege | met | PRD §6.1 roles in src/server/rbac.ts; tests/security/rbac-endpoints.test.ts and tests/e2e/rbac-sweep.spec.ts check all 116 handlers × 7 roles + anonymous |
| 4.1.5 | Fails securely | met | 401/403 before the handler runs; RLS denial (42501) answered 403 |
| 4.2.1 | Protection against IDOR | met | `assertPatientAccess` + RLS on `org_id`; tests/integration/rls.test.ts, portal-privacy.test.ts, V01-E2E-06 |
| 4.2.2 | CSRF protection | met | Origin must equal Host on every non-GET (`checkRequest` in http.ts) plus SameSite=Lax |
| 4.3.1 | MFA for administrative interfaces | partly | As 2.x MFA: TOTP when enabled on the account |
| 4.3.2 | Directory browsing off, no metadata exposed | met | No static directory listing; .git not deployed |
| 4.3.3 | Extra checks for high-value actions | partly | Erasure execution is admin-only and queued; break-glass notifies the patient; no second approver |

## V5 Validation, sanitization and encoding

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 5.1.1 | HTTP parameter pollution | partly | Query parsed with `Object.fromEntries` (last value wins) then zod; no explicit rejection of repeated keys |
| 5.1.3 | Positive input validation | met | zod on every body and query |
| 5.1.4 | Structured data strongly typed | met | zod schemas, `z.strictObject` where stray fields matter (share creation) |
| 5.1.5 | Redirects to allow-listed targets only | met | No user-supplied redirect targets found |
| 5.2.1 | HTML sanitised | met | React escaping; one `dangerouslySetInnerHTML`, the QR SVG generated server-side (src/components/registration/QrCard.tsx) |
| 5.2.6 | SSRF protection | partly | Inbound media fetched only from provider hosts (test hosts by env); no general egress allow-list |
| 5.2.7 | SVG scriptable content | met | Originals served under a sandbox CSP |
| 5.3.3 | Context-aware output encoding (XSS) | met | React; nonce + strict-dynamic CSP without unsafe-inline for scripts |
| 5.3.4 | Parameterised database queries | met | drizzle / postgres.js tagged templates; `unsafe` only in scripts with identifier quoting |
| 5.3.8 | OS command injection | n.a. | The app runs no shell commands |
| 5.5.1 | Safe deserialisation | met | JSON only, validated |

## V6 Stored cryptography

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 6.1.1 | Regulated private data encrypted at rest | met | Names, phones, DOB and similar columns as `*_enc` (envelope AES-256-GCM, src/server/crypto.ts) |
| 6.1.2 | Regulated health data encrypted at rest | met | Original files and page images encrypted per file (`encryptBytes`) |
| 6.2.1 | Crypto failures are not silent | met | AES-GCM authentication tag checked on every decrypt |
| 6.2.2 | Proven crypto libraries | met | Node `crypto` only |
| 6.2.3 | Correct IV / mode / padding | met | 96-bit random IV per encryption, GCM |
| 6.2.5 | No insecure algorithms | met | AES-256-GCM, HMAC-SHA256, Ed25519, scrypt |
| 6.2.6 | Nonces unique | met | Random IV per message and fresh data key per field or file |
| 6.3.1 | CSPRNG for random values | met | `randomBytes`, `randomInt` |
| 6.4.1 | Key management solution | not met | `APP_MASTER_KEY`, `HMAC_KEY`, `SIGNING_KEY_ED25519`, `BACKUP_KEY` are environment variables (rotation steps in docs/RUNBOOK.md); PRD §10.2 asks for KMS |
| 6.4.2 | Key material isolated from the app | not met | Same as 6.4.1 |

## V7 Error handling and logging

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 7.1.1 | No credentials or session tokens in logs | met | `redact()` (src/server/log.ts); tests/integration/log-redaction.test.ts drives real requests and searches stdout, stderr and audit_log for passwords, TOTP/OTP codes, session tokens and every secret in the environment |
| 7.1.2 | No other sensitive data in logs | met | Same test: synthetic name, phones, email, MRN, quote, passcode |
| 7.1.3 | Security events logged | met | Sign-in success and failure, break-glass, consent, erasure, document views in audit_log |
| 7.1.4 | Enough detail for a timeline | met | Timestamp, request id, actor id and role, target ids |
| 7.2.1 | Authentication decisions logged | met | `auth.login`, `auth.login_failed` audit rows |
| 7.2.2 | Access-control failures logged | partly | Every response logged with status and request id; 403s are not audit rows |
| 7.3.1 | Log injection prevented | met | JSON-encoded lines |
| 7.3.3 | Logs protected from tampering | partly | audit_log is append-only and hash-chained (verify: /api/admin/audit/verify); application logs live in the hosting provider's log store |
| 7.4.1 | Generic error with a support id | met | `{ error: { code, message } }` + `x-request-id` (http.ts) |
| 7.4.2 | Exceptions handled across the code base | met | `route()` catches everything; `unhandled` logged without the payload |

## V8 Data protection

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 8.1.1 | Sensitive data not cached by intermediaries | met | `cache-control: no-store` on every API response; files `private, no-store` |
| 8.2.1 | Anti-caching headers | met | As 8.1.1; pages render dynamically |
| 8.2.2 | Browser storage holds no sensitive data | not met | The offline capture queue keeps photos in IndexedDB unencrypted until upload (PRD segment 13 notes it) |
| 8.2.3 | Client storage cleared after the session | partly | The queue empties after upload; not on sign-out |
| 8.3.1 | Sensitive data in bodies, not URLs | partly | OTP codes, phones and passcodes travel in bodies; the demo outbox page takes a phone in the query string (demo organisations only); share keys sit in the URL fragment (never sent) |
| 8.3.2 | Users can remove or export their data | partly | Erasure on request after consent withdrawal (J8, tests/integration/erasure.test.ts); patients can share an index, no full self-export |
| 8.3.4 | Sensitive data identified and handled per policy | partly | PRD §7 and §10.3; no formal data inventory |
| 8.3.5 | Access to sensitive data audited | met | `document.view`, `patient.search`, share views; patients see "Who looked at my file" |
| 8.3.7 | Encrypted with approved algorithms | met | As V6 |
| 8.3.8 | Retention and deletion | met | Retention settings, daily erasure cron, erased patients reduced to a tombstone (drizzle/0006) |

## V9 Communications

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 9.1.1 | TLS for all client connections | met | Vercel HTTPS; HSTS 2 years with includeSubDomains (security-headers.spec.ts) |
| 9.1.2 | Strong TLS configuration | n.a. | Terminated by the hosting provider |
| 9.2.1 | TLS for outbound connections | met | Neon, Blob, Twilio, ABDM, LLM providers |
| 9.2.2 | Encrypted connections to backends | met | Same as 9.2.1 |

## V10 Malicious code

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 10.3.2 | Integrity of dependencies | partly | `package-lock.json` with integrity hashes and `npm ci`; no third-party scripts at runtime |
| 10.3.3 | Protection from subdomain takeover | n.a. | Single Vercel hostname |

## V11 Business logic

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 11.1.1 | Steps processed in order | met | Consent before processing, verified encounter before the desk opens a record, seal only by a clinician |
| 11.1.2 | Business limits per user | met | OTP limits, share passcode lockout (423, src/server/shares/shares.ts), LLM daily quota (tests/integration/llm-quota.test.ts) |
| 11.1.4 | Anti-automation for business functions | partly | Per-feature limits; no global per-IP rate limiter |
| 11.1.5 | Limits validated server-side | met | All limits in route handlers and the database |

## V12 Files and resources

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 12.1.1 | Large files refused | met | 4.5 MB per request, chunked uploads with caps (src/core/limits.ts) |
| 12.1.2 | Compressed files checked (zip bombs) | met | Entry count, unpacked size and ratio limits (src/server/pipeline/zip.ts, zip.test.ts) |
| 12.1.3 | Quotas per user | partly | Per-request and per-batch limits; no storage quota per organisation |
| 12.2.1 | Content matches the expected type | met | Magic-byte sniffing (src/server/pipeline/filetypes.ts, filetypes.test.ts) |
| 12.3.1 | User file names not used as paths | met | Files stored in Postgres; names encrypted |
| 12.4.1 | Files stored outside the web root | met | Encrypted bytea, streamed by route handlers only |
| 12.4.2 | Files scanned for malware | partly | EICAR signature and PDF active-content stripping (src/server/pipeline/safety.ts, V01-E2E-05); no anti-virus engine on serverless |
| 12.5.2 | Uploaded files never executed | met | Sandbox CSP, nosniff, served by a route handler only |
| 12.6.1 | Outbound requests to allow-listed hosts | partly | As 5.2.6 |

## V13 API and web services

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 13.1.1 | Same parsers everywhere | met | JSON and multipart only (`checkRequest`) |
| 13.1.3 | No sensitive data in API URLs | partly | As 8.3.1 |
| 13.1.4 | Authorisation at URI and resource level | met | `route()` roles + `assertPatientAccess` + RLS |
| 13.1.5 | Unexpected content types refused | met | 415 for anything but JSON or multipart |
| 13.2.1 | Only intended HTTP methods | met | Next answers 405 for methods a route does not export |
| 13.2.2 | JSON schema validation | met | zod |
| 13.2.3 | CSRF protection for the API | met | Origin check |
| 13.2.5 | Content-Type checked | met | `checkRequest` |
| 13.3.x / 13.4.x | SOAP / GraphQL | n.a. | Not used |

## V14 Configuration

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 14.1.1 | Automated, repeatable build | met | Vercel from git; CI workflow |
| 14.1.5 | Integrity of configuration verified | partly | Migrations checked by scripts/check-migrations.mts; no drift check of hosting settings |
| 14.2.1 | Components up to date, no known vulnerable ones | partly | `npm audit --audit-level=high` clean after the zod override (8 Nov 2026); 12 moderate advisories remain, all in the Vercel CLI chain and dev tooling |
| 14.2.2 | Unneeded features removed | partly | Demo endpoints (`/api/auth/demo-accounts`, demo codes, demo outbox) answer 404 unless `DEMO_MODE`; the public demo runs with it on by decision |
| 14.2.3 | SRI for third-party assets | n.a. | No third-party scripts or styles |
| 14.2.5 | Software bill of materials | not met | |
| 14.3.2 | Debug modes off in production | met | Production builds only; no source maps served |
| 14.3.3 | Headers expose no version details | partly | `X-Powered-By: Next.js` is sent (no version); set `poweredByHeader: false` in next.config.ts |
| 14.4.1 | Content-Type with charset | partly | HTML has `charset=utf-8`; JSON responses carry `application/json` without a charset |
| 14.4.2 | Content-Disposition for file APIs | partly | Originals are sent `inline` under a sandbox CSP so they can be previewed; `attachment` would be stricter |
| 14.4.3 | Content-Security-Policy | met | Nonce + strict-dynamic, object-src 'none', frame-ancestors 'none' (src/proxy.ts, src/proxy.test.ts, security-headers.spec.ts) |
| 14.4.4 | `X-Content-Type-Options: nosniff` | met | security-headers.spec.ts |
| 14.4.5 | HSTS | met | security-headers.spec.ts |
| 14.4.6 | Referrer-Policy | met | `no-referrer` |
| 14.4.7 | Framing restricted | met | `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| 14.5.1 | Only allowed HTTP methods | met | As 13.2.1 |
| 14.5.2 | Origin not used for authentication | met | Origin is only a CSRF check; identity comes from the session |
| 14.5.3 | CORS allow-list | met | No CORS headers: same-origin only |

## Not met: what each needs

| ID | Change |
|---|---|
| 2.1.7 | Check new staff passwords against a breached-password list (k-anonymity range query or an offline list) |
| 2.2.3 | Notify a staff member (email or SMS) when their password or TOTP changes |
| 2.8.4 | Store the last accepted TOTP step per staff member and refuse a code at or before it |
| 3.3.3, 3.3.4 | A "your sessions" list with "sign out everywhere"; revoke other sessions on a password reset |
| 3.4.4 | Rename the cookie to `__Host-os_sid` (it already meets the prefix's conditions on HTTPS) |
| 6.4.1, 6.4.2 | Move the master, HMAC, signing and backup keys into a KMS or HSM-backed secret manager |
| 8.2.2 | Encrypt the offline capture queue (WebCrypto key held in memory, or no offline photos on shared tablets) |
| 14.2.5 | Generate an SBOM in CI (`npm sbom` or CycloneDX) |

Also before a pilot: make TOTP mandatory for every staff account (2.x MFA, 4.3.1), remove the demo accounts and the
9-character demo password (2.1.1), and turn `DEMO_MODE` off (14.2.2).

## What this review did not cover

- No penetration test, no dynamic scan (OWASP ZAP baseline is in PRD §12 and not yet run), no review of the hosting
  provider's controls.
- Semgrep and gitleaks run in CI from 8 Nov 2026; the first Semgrep results on GitHub had not been triaged when this was
  written.
- ASVS 5.0 (May 2025) renumbers and extends these requirements; mapping to it is still to do.
