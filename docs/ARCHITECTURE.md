# OncoSetu — Architecture contract (read before writing code)

OncoSetu (formerly "OncoBridge" in the PRD) is a records-continuity layer for cancer care in India.
`docs/PRD.md` is the product spec (requirement IDs like `FR-LED-04`). This file is the **build contract**
every agent follows. It deliberately deviates from PRD §8.1 (FastAPI + Procrastinate) to one
deployable unit — see ADR at the bottom.

## Stack (fixed — do not add frameworks)

- Next.js **16.4** App Router, React 19.3, TypeScript strict, Tailwind v4. **Read `node_modules/next/dist/docs/`
  before using any Next API** — this version differs from training data (e.g. `proxy.ts` replaces middleware,
  async `params`/`cookies()`). `cacheComponents` is OFF (all pages are dynamic, per-request PHI).
- Postgres 16 on **Neon** (Singapore). ORM: **drizzle-orm 0.45** + `postgres` (postgres.js) driver.
  `DATABASE_URL` = pooled (app runtime), `DATABASE_URL_UNPOOLED` = direct (migrations, seed).
- AI: Vercel **AI SDK v7** (`ai` package). Provider chosen at runtime by `src/server/ai/provider.ts`:
  `ANTHROPIC_API_KEY` set → `@ai-sdk/anthropic`; else `AI_GATEWAY_API_KEY`/`VERCEL_OIDC_TOKEN` + `AI_ENABLED=true` → gateway
  model string `anthropic/claude-sonnet-5.5`; else **no LLM** → deterministic fallbacks (rule-based classifier +
  pattern extractor + regex header parser). The gateway currently returns 403 (no card on the Vercel team), so
  **the app must be fully functional with no LLM**. Every path goes through the same evidence gate.
  The LLM path is exercised without a key by `src/server/pipeline/llm-path.test.ts` (AI SDK test model; tests pin the
  provider with `setLlmProviderForTests`, which production never calls and which refuses to run when `NODE_ENV=production`).
- OCR: `tesseract.js` 7 (eng+hin) server-side for images/scans → per-word confidence + bbox. Text-layer PDFs via `unpdf`.
- Images re-encoded with `sharp` (strips metadata/payloads). QR via `qrcode`. YAML via `yaml`. UUIDv7 via `uuid`.
- Tests: Vitest (unit, `src/**/*.test.ts`), Playwright (E2E, `tests/e2e/**`).
- Hosting: Vercel (Fluid compute, Node runtime). Files ≤ 4 MB per request (Vercel body limit 4.5 MB) — the client
  re-encodes photos to JPEG ≤ 2400px before upload.

## Directory ownership

| Path | Owner | Notes |
|---|---|---|
| `src/db/**`, `drizzle.config.ts`, `drizzle/**` | Foundation | schema + migrations + RLS SQL |
| `src/server/**` | Foundation (shared helpers); feature agents add NEW files under `src/server/<feature>/` | never edit another feature's folder |
| `src/core/**` | Core-logic | pure, deterministic, no DB/IO, fully unit-tested |
| `src/components/ui/**`, `src/components/shell/**`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/login/**` | Design-system | feature agents compose these; add feature components under `src/components/<feature>/` |
| `src/i18n/<feature>.ts` | each feature | patient-facing strings `{ en, hi }`; scanned by copy lint |
| `scripts/demo-docs/**`, `public/demo-docs/**` | Demo-docs | synthetic documents |
| `src/app/(staff)/<area>/**`, `src/app/api/<area>/**` | feature agent named in its brief | |

Do **not** run `npm install` unless your brief allows it (shared `node_modules`, parallel agents). Do **not** run
`git commit`/`git push` — the orchestrator commits. Do not edit files outside your ownership; if you need a
shared change, put it in your final report.

## Request pipeline and policy point

All mutations go through **route handlers** under `src/app/api/**/route.ts`, wrapped by
`route()` from `src/server/http.ts`:

```ts
export const POST = route({ auth: 'staff', roles: ['records','clinician'], body: zSchema }, async (ctx) => {
  // ctx.session  { kind:'staff'|'patient'|'caregiver', staffId?, role?, orgId, patientId?, caregiverId? }
  // ctx.body     parsed by zod; 400 on failure
  // ctx.db       a drizzle transaction with RLS `app.org_id` set (withOrg)
  // ctx.audit(action, targetType, targetId, details?)  ids only, never PHI
  // ctx.requestId
  return { ok: true }            // serialised as JSON 200; throw HttpError(status, code, msg) otherwise
})
```

- `auth`: `'staff' | 'patient' | 'any' | 'public'`. Patient/caregiver sessions are scoped to one patient.
- Errors: JSON `{ error: { code, message } }`, uniform messages for not-found vs forbidden on enumerable ids.
- CSRF: wrapper rejects non-GET requests whose `Origin` does not match the host, and requires JSON or multipart.
- Server components read data through functions in `src/server/**` after `await requireStaff(roles?)` /
  `requirePatientSession()`; they never `fetch` their own API.
- Consent is **checked on use** (`assertConsent(patientId, purpose)`), never cached.

## Data model

Every patient-scoped table carries `org_id` and `patient_id`; RLS forced, policy
`org_id = current_setting('app.org_id')::uuid`; app connects as non-owner role `oncosetu_app`. Public routing
lookups (QR token, phone, share id) use `SECURITY DEFINER` SQL functions that return ids only.
PII columns (`name_enc`, `dob_enc`, `phone_enc`, …) are AES-256-GCM envelope-encrypted with `APP_MASTER_KEY`;
equality lookups use HMAC blind indexes (`phone_hmac`, `token_hash`). Original files are stored encrypted
(`bytea`) in `document_files` — no public URLs anywhere.

Tables (PRD §7.1 + additions): organisations, staff, sessions, otp_challenges, patients, patient_aliases,
caregivers, consents, encounters, documents, document_files, document_pages, events, evidence,
patient_statements, verifications, snapshots, missing_records, record_requests, share_links, share_views,
ai_runs, audit_log (hash-chained), devices, outbox (SMS/WhatsApp record, simulated unless a provider is configured), break_glass,
measurement_forms, org_settings (feature flags, demo clock offset, retention), rule_states (per-org rule
production/shadow), patient_merges.

Enums follow PRD exactly: event types §7.2, provenance axes §7.3, verification statuses FR-VER-01, missing-item
states FR-RAD-03, request states FR-REQ-03, disclosure `cleared|not_cleared|unknown`.

## Time

All "now" reads go through `now(orgId)` in `src/server/clock.ts` so demo mode can fast-forward an org's clock
(V04-E2E-02: reminders at +7 / +21 days). Server time is authoritative; client times stored as `client_captured_at`.

## Patient-facing copy (FR-CON-07 — safety critical)

- Patient/caregiver surfaces (patient portal `/p/**`, SMS/outbox bodies, share viewer `/s/**`, request letters,
  printed QR cards) use strings from `src/i18n/*.ts` only, and document-type labels from
  `patientDocLabel(type, disclosure)` in `src/core/copy`.
- Unless `disclosure_status = 'cleared'`: no diagnosis/staging/treatment-class words (list in
  `src/core/copy/banned.ts`), no source quotes, and the brand shows as **"Setu Records"** instead of "OncoSetu"
  (the name itself contains "Onco").
- Radar wording is administrative only ("<document> not in file for <event> documented on <date> (<source>)").
- Staff UI is English and may show quotes.

## Logging

`src/server/log.ts` — JSON lines with request id; never names, phones, quotes or file contents. Audit log rows
carry ids only.

## SMS provider

`sendMessage(tx, …)` in `src/server/outbox.ts` always writes the `outbox` row first, inside the caller's transaction
(masked number + HMAC + body; the plaintext number is never stored). `src/server/sms/provider.ts` decides what happens
next: `smsProvider(channel)` returns a Twilio REST adapter when the Twilio env vars are set (SMS: account SID + auth token +
`TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID`; WhatsApp: account SID + auth token + `TWILIO_WHATSAPP_FROM`), otherwise
`null`. With `null` the row's `delivery` is `simulated` and nothing leaves the server (demo and local dev; the demo phone
panel reads the outbox either way and shows each row's `delivery`).

With a provider the row is inserted as `queued` and delivery runs **after the request transaction commits**: Next's
`after()` inside a request, a direct call outside one (scripts, tests). A slow provider therefore never holds a pooled
connection (POOL RULE, `src/db/index.ts`). The plaintext number travels only in that in-memory closure. The delivery step
first confirms the row exists and is still `queued` (`after()` also runs when the request rolled back, and then nothing
must be sent), calls Twilio, retries once after 1 s on a 5xx (never on a 4xx or a network error, where a second send
could duplicate), and records the outcome with a short `withOrg()`: `sent` + `provider_message_id`, or `failed` +
`delivery_error` (`twilio_<code>`, `http_<status>`, `timeout`, `network`; never the provider's message text, which can
quote the number). `sent` means accepted by Twilio: delivery receipts (status callbacks) are not tracked. Columns:
migration `drizzle/0007_outbox_delivery.sql`. Only ids, channel and codes are logged.
`GET /api/cron/outbox` (daily, Bearer `CRON_SECRET`, `src/server/sms/sweep.ts`) re-delivers rows still `queued` after 5 min:
the number is recovered from the patient/caregiver phone in the same org whose HMAC equals `to_hmac` (decrypted in memory),
else the row becomes `failed` / `stale_no_recipient`.

## Inbound channels (FR-ING-04 email drop, FR-ING-05 WhatsApp)

Code in `src/server/inbound/**`, tables in `drizzle/0008_inbound_channels.sql` (RLS forced, least-privilege grants).
Both webhooks are plain route handlers, not `route()`: provider calls carry no `Origin`, so each authenticates itself
(503 when its env is unset). Both resolve the patient through `SECURITY DEFINER` lookups that return ids only, then do
everything in one `withOrg()` and hand files to `ingestDocument` (`intakeRoute` `'email'` / `'whatsapp'`, uploaded by
the patient or caregiver) + `scheduleProcessing`. Nothing from a message body is stored; audit rows carry ids only.

- **Email** `POST /api/inbound/email` (Postmark inbound JSON, HTTP Basic `INBOUND_EMAIL_USER`/`PASSWORD`, timing-safe).
  Recipient `<alias_token>@INBOUND_EMAIL_DOMAIN` → `resolve_inbound_alias(token)` (`inbound_aliases`, one active per
  patient, 80-bit base32). Sender → `resolve_contact_email(email_hmac)` (`contact_emails`: verified in person by a staff
  member, for the patient or an active caregiver). No match → `200 {accepted:false, reason:'unregistered_sender'}` +
  audit `inbound.email_rejected`, nothing stored. Staff manage both on the Consent tab
  (`src/components/inbound/EmailDropPanel.tsx`, `POST /api/patients/[id]/inbound-alias`, `.../contact-emails`,
  `.../contact-emails/[contactId]/revoke`).
- **WhatsApp** `POST /api/inbound/whatsapp` (Twilio form post). `X-Twilio-Signature` = HMAC-SHA1(`TWILIO_AUTH_TOKEN`,
  `PUBLIC_BASE_URL` + path + sorted params), 403 on mismatch. `From` must resolve through `phoneLogins()` to exactly one
  record (caregiver-primary/minor rules), else a neutral reply and nothing stored. Media are downloaded before the
  transaction (Twilio basic auth when `TWILIO_ACCOUNT_SID` is set; `api.twilio.com` only in production; ≤ 4 MB; sniffed
  type) and **held**: `inbound_holds` (one open hold per patient + sender, partial unique index, so parallel webhooks
  share it) + `inbound_hold_files` (encrypted bytes, no `documents` row, so held files never reach the record, Radar or
  the pipeline). The code goes out with `sendMessage` (channel `whatsapp`) and is issued by `startOtp`, so it counts
  towards the per-phone budget. The right code within 10 min creates the documents (`document_ids`) and deletes the held
  bytes; 5 wrong codes delete the hold; an expired hold is deleted by the sender's next message or
  `GET /api/cron/inbound-holds` (daily). Replies are TwiML from `src/i18n/inbound.ts` (brand via `brandFor`).
  Lock order in every branch: expired hold rows → the open hold → the org audit lock.
- **Erasure**: a trigger on `patients.status → 'erased'` deletes the patient's `contact_emails`, `inbound_aliases` and
  holds; `contact_emails.caregiver_id` cascades when `erase_patient()` deletes caregivers.

## ABDM HIU (FR-ING-ABDM-01/02, journey J6)

Code in `src/server/abdm/**`, pure FHIR mapping in `src/core/fhir/**`, tables in `drizzle/0009_abdm.sql`
(`abdm_consent_requests`, `abdm_transfers`; RLS forced; the app role may SELECT/INSERT/UPDATE, never DELETE).

- **Transport.** `AbdmTransport` mirrors the HIU gateway calls: `initConsentRequest` → `consentStatus` / hiu-notify →
  `fetchArtefact` → `requestHealthInformation` (HIU ephemeral X25519 key material + nonce, date range, consent id) → data
  push (entries + HIP key material) → `notifyTransfer`. `abdmTransport()` returns `InProcessGateway` when no `ABDM_*` env is
  set (in-process consent manager + HIP over the synthetic bundles in `data/abdm/`; it encrypts for real and returns the push
  to the caller; `decide`/`revoke` stand in for the patient's ABHA app) and `SandboxGateway` when `ABDM_CLIENT_ID`,
  `ABDM_CLIENT_SECRET` and `ABDM_BASE_URL` are all set (v3 gateway HTTP client; answers arrive on callbacks, which are not
  built — no sandbox account). A partial `ABDM_*` set is a 503.
- **Crypto** (`crypto.ts`): shared = X25519; xor = nonce_HIU XOR nonce_HIP; key = HKDF-SHA256(shared, salt = xor[0..20),
  info = ∅, 32); AES-256-GCM, IV = xor[20..32), content = base64(ct ‖ tag). Keys are X.509 SPKI base64 in
  `dhPublicKey.keyValue`. Known-answer vectors in `crypto.test.ts`.
- **Consent gate** (`gate.ts`): before any entry is decrypted, OncoSetu's own purposes (`store` + `abdm`, checked on use)
  and the stored artefact (GRANTED, before `dataEraseAt`, `patientHmac` = the patient's `abha_hmac`, requested HI types and
  date range inside the artefact) are re-checked. Decryption is all or nothing (tag, key, nonce, MD5 checksum); a refusal
  records the transfer FAILED with a code and writes nothing else. After decryption each bundle's record type and
  Composition date must fall inside the artefact.
- **Flow** (`flow.ts`, all on the caller's transaction — POOL RULE): staff `POST /api/patients/[id]/abdm/consent-requests`
  (records/clinician; `abdm` purpose + ABHA required; neutral SMS `abdm.consent_request` to the primary contact) → patient
  `POST /api/p/abdm/[requestId]` `{ decision: approve|deny|revoke }` → artefact stored with the ABHA replaced by its HMAC →
  transfer → `mapBundle` → one `documents` row per bundle (`intake_route 'abdm'`, `application/fhir+json`, status `done`,
  attach `auto`, identity `match` via the artefact, original encrypted with `storeFile`) + events
  (`external_structured` / `structured_map`) + evidence (`fhir_resource_ref`, `quote_sha256` = SHA-256 of the canonical
  resource JSON, no quote) → `recomputeRadar`. `GET /api/patients/[id]/abdm` feeds the Documents-tab panel
  (`src/components/abdm/AbdmPanel.tsx`); the source viewer renders `AbdmDocument` for `intake_route 'abdm'` (fact beside its
  FHIR resource; opening one logs `event.source_viewed`).
- **Erase** (PRD §10.5): `abdm_erase(request)` (SECURITY DEFINER) deletes the request's documents, files, pages, events (all
  versions), evidence, verifications + QA reviews and AI-run rows, unlinks Radar rows and record requests, marks transfers
  ERASED; it refuses unless the request is REVOKED or `erase_at` passed (real time) and across orgs. Callers re-run the
  Radar. Triggered by revoke, `GET /api/cron/abdm-erase` (daily, Bearer `CRON_SECRET`) and on read (panel, portal page,
  ABDM source view). Sealed snapshots keep what they sealed. Patient erasure deletes the ABDM rows by trigger.
- **Mapping** (`src/core/fhir`): DiagnosticReport → imaging / pathology / lab report events (category or LOINC);
  DischargeSummary → admission + discharge (Encounter) + procedures; OPConsult → consultation; Prescription → medicine
  names only. Every event passes `checkStructuredFields` (the evidence gate's field rules). Nothing is read from Condition,
  Observation values, conclusions or dosage.

## Design system — "Museum Placard" (brag-styles set, extended for a clinical UI)

Each fact is exhibited like an artwork with its **placard**: WHAT · WHERE (document, page, quote) · WHO verified ·
WHEN. Missing records are **empty frames** on the gallery wall. Gallery white, a warm spotlight, label ink, mono
accession codes (short hashes). Signature move as UI feedback: the placard fades in after its item; the quote
highlight sweeps in like a spotlight; sealing a snapshot presses a brass seal. All motion inside
`prefers-reduced-motion: no-preference`. Use the components in `src/components/ui` — do not restyle ad hoc.

## ADR-001a (supersedes PRD ADR-001 for the prototype)

One Next.js app on Vercel instead of Next + FastAPI + Procrastinate worker: one deployable, one policy point
(route handlers), Postgres-backed processing state machine instead of a queue (documents move
`queued → processing → done|needs_review|failed`; a stale `processing` lock is re-claimed by the next status poll
or the "reprocess" action). Python OCR (PaddleOCR) replaced by tesseract.js; the `OcrProvider` interface keeps
cloud document AI swappable. Files in Postgres `bytea` (encrypted) instead of object storage — ceiling: a few GB;
move to object storage before pilot.

## Cross-feature interfaces (phase 2 — code against these exact names)

| Interface | Owner | Signature / route |
|---|---|---|
| Ingest a file | Pipeline | `src/server/pipeline/ingest.ts` → `ingestDocument(tx, { orgId, patientId, uploadedBy: { kind: 'staff'\|'patient'\|'caregiver', id }, intakeRoute: 'desk'\|'bulk'\|'patient_link'\|'offline_sync'\|'email'\|'whatsapp', clientFileId?, encounterId?, fileName, mime, bytes: Uint8Array, clientCapturedAt? }) → { documentId, status, duplicateOf?: string, nearDuplicateOf?: string }` then `scheduleProcessing(documentId, orgId)` (uses `after()`) |
| Recompute Radar | Pipeline | `src/server/pipeline/radar.ts` → `recomputeRadar(tx, orgId, patientId)` (call after any change to events/documents) |
| Staff upload | Pipeline | `POST /api/patients/[id]/documents` multipart `file`, `clientFileId?`, `intakeRoute?`, `encounterId?` |
| Patient upload | Patient-portal | `POST /api/p/documents` (same multipart; calls `ingestDocument`) |
| Document status | Pipeline | `GET /api/documents/[id]/status` → `{ status, stage, stages:[{key,state}], identity, flags }` |
| Source viewer deep link | Pipeline | `/patients/[id]/documents/[docId]?event=<eventId>` highlights that event's quote and logs `viewed_source` |
| Event verification | Ledger | `POST /api/events/[id]/verify` `{ action: 'verify'\|'edit'\|'reject'\|'dispute', reason?, fields?, rowVersion }` |
| Seal snapshot | Ledger | `POST /api/patients/[id]/seal` → `{ snapshotId, sha256, signature, keyId }`; public `GET /api/snapshots/[id]/verify` |
| Share creation (client) | Radar-share | `src/components/shares/CreateShareForm.tsx` `({ patientId, actor: 'staff'\|'patient' })` — fetches `GET /api/patients/[id]/share-payload` (staff) or `GET /api/p/share-payload` (patient), encrypts in browser, `POST /api/shares` |
| Requests list (client) | Radar-share | `src/components/requests/RequestList.tsx` `({ patientId, actor })`; letter print page `/print/request/[id]?lang=en\|hi` |
| Device registration | Offline | `POST /api/devices/register` → `{ deviceId }`; every upload from the capture app sends header `x-device-id`; a revoked device gets 410 `{error:{code:'device_revoked'}}` |
| Patient-facing strings | each feature | `src/i18n/<feature>.ts` exporting `{ en: Record<string,string>, hi: Record<string,string> }` |

Route ownership under `src/app/(staff)/patients/[id]/`: `overview`, `consent`, `audit` → Registration; `documents/**` → Pipeline;
`timeline`, `ledger` → Ledger; `completeness`, `requests`, `shares` → Radar-share; `statements` → Patient-portal.
`src/app/(staff)/patients/[id]/layout.tsx` (header + tabs) is owned by the orchestrator.
