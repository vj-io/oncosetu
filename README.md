# OncoSetu

Records continuity for cancer care in India: every displayed fact traces to a verbatim source quote, and referenced documents that are missing from the file are listed.

**Live demo:** https://oncosetu-zeta.vercel.app
Demo mode: sign in with the one-click demo accounts on /login (synthetic data only). A 6-minute judge walkthrough is in [docs/DEMO.md](docs/DEMO.md).

OncoSetu was named OncoBridge in PRD v1.0. "Setu" means bridge. This is an academic and hackathon prototype. A clinician-led pilot requires ethics (IEC) approval before any real patient data is used.

## The problem

- **Records are scattered.** A patient's cancer history sits across hospitals as paper, phone photos and WhatsApp PDFs, and every new centre starts from scratch (see docs/PRD.md §2.4).
- **The volume is large.** About 1.57 million new cancer cases were projected for India in 2025, and National Cancer Grid member centres treat more than 860,000 new patients a year. 55.7% of rural survivors in one study sought a second opinion, and the median travel time to a tertiary centre was 4.3 hours (see docs/PRD.md §2.4 and §4.1).
- **The burden is unmeasured.** We found no Indian study that measures how often outside records are missing at an oncology consultation, or how often tests are repeated for that reason (see docs/PRD.md §2.4). The pilot's measurement study is designed to produce that number.

## What OncoSetu does

The core loop:

1. **Capture.** A desk tablet (multi-page camera), a patient or caregiver upload link protected by OTP, bulk PDF and photo upload, a per-patient email drop address, or WhatsApp forwarding confirmed with a one-time code (see Inbound channels). Handwritten pages are stored as images and are never auto-extracted.
2. **Evidence-gated extraction.** Extraction proposes events, each with a quote. A deterministic gate accepts only quotes found verbatim in the page text, checks that fields and dates appear in that quote, and checks identity per document. Event, document and received dates are kept separate.
3. **Document index and timeline.** Each item shows what it says, where (page and quote), who verified it and when. Records staff verify against the source. A clinician sees key items and conflicts.
4. **Missing-Record Radar.** Deterministic rules on documented events list referenced documents that are not in the file, for example "histopathology report not in file" for an excision documented on a given date. It is a document-completeness checklist. Rules run in shadow mode until a clinician reviews them.
5. **Records Request Kit.** English and Hindi request letters, tracked through states, with reminders at 7 and 21 days and an escalation information sheet. The letters make no deadline promise.
6. **Change Ledger and sealed snapshots.** A returning visit is compared with the last sealed snapshot: new since last visit, newly received older records, amended, conflicts, what the patient said, missing items, and suppressed duplicates. A sealed snapshot is hashed (SHA-256 over canonical JSON) and signed with Ed25519.
7. **Share links.** Passcode-protected, expiring and revocable. The payload is encrypted in the browser, and the key sits in the URL fragment, so it never reaches the server. The viewer needs no account and sees "Document index, not a clinical summary" together with the documents that are not in the file.

Around the loop:

- **Patient and caregiver portal:** OTP sign-in, caregiver-primary accounts, and pre-visit questions with text read-back.
- **Offline desk capture (PWA):** an encrypted local queue that syncs when the network returns.
- **Admin console:** rule review, the audit-chain view, metrics, and the measurement study.

## Safety by design

### Evidence gate

Every displayed fact must trace to a verbatim source quote. The gate rejects a candidate whose quote is not found in the page text (`quote_not_found`), whose field or date does not appear in the quote (`field_not_in_quote`, `date_not_in_quote`), or whose field or event type is not allowed. Quotes must be 8 to 300 characters. The rule-based and LLM paths pass through the same gate.

The gate does not catch every error. PRD §9.4a sets out what it covers:

| Error class | Caught by the gate? | Control |
|---|---|---|
| Fabricated fact | Yes: the quote is not found | Gate. Unsupported facts reaching the record: 0 on the eval set |
| Omission | No | Clinician-abstracted gold set; per-class recall reported to verifiers |
| Right quote, wrong field, date or patient | No, partly | Binding checks (FR-EXT-09), `binding_uncertain` flag, per-document identity check |
| Faithfully quoted OCR error | No | Span-confidence flag below 0.80; low-confidence spans are always human-verified |
| Prompt injection changing output | Partly | Forbidden fields are rejected; the model has no tools |
| Wrong document type | No | Human tagging on low confidence |

The only claim made is that every displayed fact is traceable to a verbatim source quote.

### Neutral copy until disclosure is cleared (FR-CON-07)

In published Indian studies, 46–54% of cancer patients were unaware of their diagnosis (see docs/PRD.md §2.4). Patient-facing surfaces therefore default to neutral wording. Unless `disclosure_status` is `cleared`, patient-facing text contains no diagnosis, staging or treatment words and no source quotes, and the brand appears as "Setu Records" instead of "OncoSetu". `unknown` is treated as not cleared. Patient-facing strings live in `src/i18n/*.ts`, and a unit test lints each one (`src/core/copy/copy-lint.test.ts`). Radar wording is administrative only.

### Nothing clinical

The intended-use statement (draft for CDSCO and ethics review, PRD §6.6):

> OncoSetu is records-management software that stores, organises and displays documents and patient statements provided for a person receiving cancer care, links each displayed item to its source, identifies source documents that are referenced but absent from the file, and supports authorised people in verifying, sharing and requesting records. It does not diagnose, stage, predict, risk-score, interpret images or results, recommend or alter treatment, or calculate doses. All clinical decisions are made by qualified professionals using the source documents.

- The data model has no derived clinical attributes.
- The ledger orders items by category and date, not by clinical importance.
- The system does not generate words such as "progression" or "abnormal". Words from a source document appear only inside its quote.
- Every shared or printed output carries the heading "Document index, not a clinical summary".

### Shadow mode

Every starter Radar rule is unreviewed, so each runs in shadow mode until a clinician records a review (FR-RAD-05).

## Architecture

```
Browser: staff desk, patient portal, capture PWA, share viewer
   |  HTTPS; JSON or multipart only; Origin must match the host
   v
Next.js 16 route handlers (src/app/api/**)  -- single policy point
   route(): auth, role, zod body, CSRF, consent checked on use, audit (ids only), request id
   |
   +--> processing pipeline (Postgres state machine:
   |      queued -> processing -> done | needs_review | failed)
   |      text/OCR -> classify -> identity -> extract -> evidence gate -> Radar
   v
Postgres 16 (Neon, Singapore): RLS forced on patient tables, non-owner app role
   PII envelope-encrypted; original files as encrypted bytea; hash-chained audit_log
```

The pipeline stages map to pure functions in `src/core`: `classifyDocument`, `decideIdentity`, `extractFallback` (or the LLM `extraction.v1` contract), `runGate` and `runRadar`.

### Stack

| Layer | Choice |
|---|---|
| Web | Next.js 16.4 (App Router), React 19.3, TypeScript (strict), Tailwind CSS v4 |
| Data | Postgres 16 on Neon; drizzle-orm 0.45 with the `postgres` driver. Pooled `DATABASE_URL` for the app, direct `DATABASE_URL_UNPOOLED` for migrations and seeds |
| AI (optional) | Vercel AI SDK v7 (`ai`) with `@ai-sdk/anthropic`, or Vercel AI Gateway |
| OCR and files | tesseract.js 7 (English and Hindi), unpdf (text-layer PDFs), sharp (re-encodes images and strips metadata) |
| Other | zod 4, qrcode, yaml, uuid (UUIDv7) |
| Tests | Vitest 5 (unit and integration), Playwright (E2E) |
| Hosting | Vercel, Fluid compute, Node runtime, region `sin1` (`vercel.json`) |

### Deviation from the PRD (ADR-001a)

`docs/ARCHITECTURE.md` (ADR-001a) supersedes PRD §8.1 for the prototype:

- One Next.js app is the only deployable, instead of Next.js, FastAPI and a Procrastinate worker.
- A Postgres-backed state machine replaces the job queue. A stale `processing` lock is re-claimed by the next status poll or by the reprocess action.
- tesseract.js 7 replaces PaddleOCR. The `OcrProvider` interface keeps cloud document AI swappable.
- Files are stored as encrypted `bytea` in Postgres instead of object storage. The ceiling is a few GB, and object storage is needed before the pilot.
- Staff sign-in uses scrypt passwords and TOTP, and patient sign-in uses OTP, both implemented in the app. PRD §8.1 named Supabase Auth.
- The pipeline is TypeScript, not Python. Its logic is pure functions in `src/core`.
- Hosting is Vercel with the database in Neon, Singapore. PRD §8.1 allowed India or Singapore regions.

### Optional LLM

No LLM provider is required. With none configured, the app runs fully on deterministic code: a rule-based classifier, a pattern extractor and a regex header parser. To enable LLM extraction, set `ANTHROPIC_API_KEY` (direct Anthropic API, model `claude-sonnet-5-5`), or set `AI_ENABLED=true` with `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` (Vercel AI Gateway, model `anthropic/claude-sonnet-5.5`). LLM use also requires the organisation's `ai_extraction` flag and the patient's consent for purpose `ai`, both checked on each use. LLM output goes through the same evidence gate.

## Security

- **Row-level security.** Patient-scoped tables carry `org_id` and `patient_id`. RLS is forced, and the app connects as the non-owner role `oncosetu_app`. Public routing lookups (QR token, phone, share id) use `SECURITY DEFINER` functions that return ids only. A QR code identifies a patient and never authorises access.
- **Encryption.** PII columns use AES-256-GCM envelope encryption under `APP_MASTER_KEY`. Original files are stored encrypted. Equality lookups use HMAC-SHA256 blind indexes under `HMAC_KEY`.
- **Staff sign-in.** scrypt password hashes and TOTP.
- **Patient sign-in.** A 6-digit OTP, hashed at rest, expiring after 5 minutes. A phone is locked for 15 minutes after 5 failed attempts, and failures return uniform messages.
- **Audit.** An append-only, per-organisation, hash-chained `audit_log`. A database trigger blocks UPDATE and DELETE, even for the owner. Rows carry ids and enums only.
- **Consent.** Checked on use, never cached.
- **Web.** A nonce-based Content-Security-Policy on every response, HSTS, and a sandboxed CSP on file routes (`src/proxy.ts`). State-changing requests must come from the app's own origin and be JSON or multipart.
- **Sharing.** The share payload is encrypted in the browser with a fresh AES-256-GCM key. The key is in the link's URL fragment, which browsers do not send to a server.
- **Uploads.** Images are re-encoded with sharp, which strips metadata. An EICAR signature check runs on upload. It is a signature check, not a full antivirus scan.
- **Logs.** JSON lines with a request id. Logs never contain names, phone numbers, quotes or file contents.
- **Demo mode.** `DEMO_MODE=true` shows the demo accounts on /login, and that endpoint returns each demo password and the current TOTP code. Set it only on the demo deployment, never on one that holds real data.

## Inbound channels

Two ways for a patient or caregiver to send papers without signing in. Both store files through the same intake as an upload (`ingestDocument`: hash, dedupe, safety scan, encryption) and run the same pipeline. Neither keeps a message body.

- **Email drop (FR-ING-04).** Staff open the patient's Consent tab, create the drop address `<alias>@INBOUND_EMAIL_DOMAIN` (80-bit random, replaceable) and add the patient's or a caregiver's address after checking it in person. Postmark posts each mail to `POST /api/inbound/email` (HTTP Basic, `INBOUND_EMAIL_USER`/`INBOUND_EMAIL_PASSWORD`; webhook URL `https://USER:PASSWORD@<host>/api/inbound/email`). Mail from any other address gets `200 {accepted:false, reason:'unregistered_sender'}`, an `inbound.email_rejected` audit row and nothing else (V05-E2E-07). Limits: 10 attachments per mail, 4 MB each, PDF/JPEG/PNG/WebP/HEIC.
- **WhatsApp (FR-ING-05).** Twilio posts each message to `POST /api/inbound/whatsapp`; the `X-Twilio-Signature` is checked over `PUBLIC_BASE_URL` + path with `TWILIO_AUTH_TOKEN` (403 on mismatch). The sender's number must be the registered phone of exactly one record (caregiver-primary and minor rules apply), otherwise the reply is "Please use the upload link the clinic sent you" and nothing is stored. Media (4 MB each, the same types, 10 per hold) are held encrypted, not as documents, until the sender replies with the 6-digit code sent over WhatsApp. The code counts towards the per-phone code budget (3 per 10 minutes, 10 per day). The right code within 10 minutes turns the files into documents and starts processing. Five wrong codes delete them. An expired hold is deleted by the sender's next message or by the daily `GET /api/cron/inbound-holds`.
- **Outbox sweeper.** The daily `GET /api/cron/outbox` re-sends messages stuck in `queued` for more than 5 minutes. It recovers the number from the matching patient or caregiver phone, and marks the message `failed` (`stale_no_recipient`) when no phone matches.
- **Deployment.** Vercel has `INBOUND_EMAIL_*` and `PUBLIC_BASE_URL` but no `TWILIO_*`, so `/api/inbound/whatsapp` answers **503** there. The configured `INBOUND_EMAIL_DOMAIN` (`inbound.oncosetu.test`) is a reserved placeholder that cannot receive mail. A real drop address needs a domain with an MX record pointing at Postmark's inbound server and a Postmark inbound webhook with the URL above.

## Evaluation

Source: `data/eval/report.json` (generated 1 November 2026, rule-based path). An extracted event counts as correct when it matches at least one gold fact on type, date and text.

| Measure | Result |
|---|---|
| Unsupported facts reaching the record | 0 |
| Handwritten pages auto-extracted | 0 |
| Event precision | 0.949 (37 of 39 extracted events correct) |
| Event recall | 0.962 (50 of 52 gold facts found) |
| Identity decision | 20 of 20 documents |
| Document classification | 0.95 (19 of 20) |
| Prompt-injection test document | Flagged; no forbidden field accepted |

Per document class:

| Class | Gold facts | Recall | Extracted | Precision |
|---|---|---|---|---|
| Pathology report | 7 | 0.857 | 7 | 0.857 |
| IHC / molecular report | 1 | 1.000 | 2 | 0.500 |
| Imaging report | 2 | 1.000 | 2 | 1.000 |
| Lab report | 3 | 1.000 | 3 | 1.000 |
| Printed prescription | 11 | 1.000 | 5 | 1.000 |
| Discharge summary | 23 | 0.957 | 15 | 1.000 |
| Chemotherapy day-care record | 4 | 1.000 | 4 | 1.000 |
| Other | 1 | 1.000 | 1 | 1.000 |

Handwritten prescriptions have 0 gold facts and 0 extracted events, by design. The two missed gold facts are a wide local excision (`hero__10-histopathology-later.pdf`) and a pending histopathology report (`returning__01-discharge-summary.pdf`). The two wrong events are procedure events: one has no date (`hero__10`), and one comes from an IHC report (`hero__11`). One document was classified as IHC/molecular instead of pathology (`returning__07`).

Caveats:

- The set is 20 synthetic documents in `public/demo-docs/`, authored by the team. PRD §9.5 specifies 60 documents across 15 types. The larger set is not built.
- The gold labels were written on the same documents the rules were tuned on. These numbers are not held-out.
- The run used the rule-based path only (`"method": "rules"`; no AI runs are recorded).
- Against the PRD §9.5 targets, precision (0.949) is just under the ≥ 0.95 target, and recall meets the ≥ 0.85 target. The report's `pass` flag covers only the two hard gates.
- The PRD's identity target (mismatch recall ≥ 0.99 on 200 header pairs) is not what this report measures. The identity unit tests (`src/core/identity/identity.test.ts`) use a 360-pair generated set: mismatch recall 100%, false-match rate 0%.

Rerun with `npx tsx --env-file=.env.local scripts/eval.ts`. It overwrites `data/eval/report.json` and exits with code 1 if a hard gate fails.

## Run locally

Prerequisites:

- Node.js 22 or later
- A Postgres 16 database (the project uses Neon), with a pooled and a direct connection string
- npm (`package-lock.json` is committed)

Environment variables (names and purpose only; the repository ships no key generator):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled Postgres URL for the app runtime |
| `DATABASE_URL_UNPOOLED` | Direct Postgres URL for migrations and seeds |
| `DATABASE_URL_APP` | Connection as role `oncosetu_app`. `scripts/migrate.ts` appends it to `.env.local` on first run |
| `APP_MASTER_KEY` | Base64, 32 bytes. Envelope encryption of PII and files |
| `HMAC_KEY` | Base64, 32 bytes. Blind indexes |
| `SIGNING_KEY_ED25519` | Base64 of a PKCS#8 PEM Ed25519 private key. Signs snapshots |
| `SIGNING_KEY_ID` | Identifier for the signing key, for rotation |
| `DEMO_MODE` | Set to `true` to enable the demo accounts, the simulated phone outbox and the demo clock |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Optional. Real SMS and WhatsApp delivery through Twilio. Also needs a sender, below |
| `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | Optional. SMS sender (the Messaging Service wins if both are set) |
| `TWILIO_WHATSAPP_FROM` | Optional. WhatsApp sender; without it WhatsApp messages stay simulated |
| `INBOUND_EMAIL_USER`, `INBOUND_EMAIL_PASSWORD` | Optional. HTTP Basic credentials Postmark sends to `/api/inbound/email`; unset → 503 |
| `INBOUND_EMAIL_DOMAIN` | Optional. Domain of the per-patient drop addresses (MX pointing at Postmark); unset → email drop off |
| `PUBLIC_BASE_URL` | Optional. Public origin Twilio calls (e.g. `https://oncosetu-zeta.vercel.app`), used to check `X-Twilio-Signature`. With `TWILIO_AUTH_TOKEN` it turns on `/api/inbound/whatsapp`; either unset → 503 |
| `CRON_SECRET` | Bearer secret Vercel Cron sends to `/api/cron/*` (erasure, inbound holds, outbox sweeper) |
| `ANTHROPIC_API_KEY` | Optional. LLM via Anthropic |
| `AI_ENABLED`, `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | Optional. LLM via Vercel AI Gateway |
| `E2E_PASSWORD` | Optional. Password for the E2E staff that `seed-base.ts` creates |
| `BASE_URL`, `PW_CHANNEL`, `E2E_SHOT_DIR` | Optional. E2E runner settings |

Setup:

```bash
npm install
# create .env.local with the variables above
npx tsx --env-file=.env.local scripts/migrate.ts
npx tsx --env-file=.env.local scripts/seed-base.ts
npm run dev
```

Open http://localhost:3000/login. The demo accounts appear there only when `DEMO_MODE=true` is set in `.env.local`. The synthetic documents are committed in `public/demo-docs/`. Regenerate them only when changing the generator, with `npx tsx scripts/demo-docs/generate.ts`.

Scripts and commands (from `package.json` and `scripts/`):

| Command | What it does |
|---|---|
| `npm run dev` | Next.js development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Vitest, `src/**/*.test.ts`) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:integration` | RLS integration tests; needs a live database |
| `npx tsx --env-file=.env.local scripts/migrate.ts` | Applies `drizzle/` migrations as the owner. First run sets the app role's password and appends `DATABASE_URL_APP` to `.env.local` |
| `npx tsx --env-file=.env.local scripts/seed-base.ts` | Idempotent base seed: two fictional organisations, demo staff and organisation settings. No patients |
| `npx tsx --env-file=.env.local scripts/seed-demo.ts --base http://localhost:3000` | Demo reset: wipes the demo organisation's patient data and rebuilds the three synthetic patients (plus a minor) by driving the running app's own API — uploads, OCR, gate, verification, seals, requests, a share link. Prints the share URL. About 9 minutes |
| `npm run test:e2e` | Playwright E2E suite against `BASE_URL` (default http://localhost:3000) |
| `npx tsx scripts/demo-docs/generate.ts` | Regenerates the synthetic documents and their manifest in `public/demo-docs/` (deterministic) |
| `npx tsx --env-file=.env.local scripts/eval.ts` | Runs the offline evaluation and rewrites `data/eval/report.json`. Add `--llm` for the LLM path |

## Tests

- **Unit (Vitest):** `npm test` — 45 files, 945 tests. They cover the LLM extraction path with the AI SDK's test model, SMS/WhatsApp delivery with a stubbed `fetch`, the evidence gate (including property tests that no accepted quote is anything but an exact slice of its page), the India-first date parser, the transliteration-aware identity matcher (360 labelled pairs: mismatch recall 100%, false-match 0%), the Radar engine and merge rules, the ledger diff, seal hash/signature tamper detection, request reminders, share crypto and signatures, copy lint over every patient-facing string, the pipeline's upload safety checks, and the inbound channels (Twilio signature known-answer vector, Postmark parsing, the WhatsApp hold state machine).
- **Integration (RLS):** `npm run test:integration` (needs a live database) — `rls.test.ts` (10 tests) proving, as the app role, that nothing is visible without `app.org_id`, cross-organisation reads/updates/deletes/inserts are denied, `SECURITY DEFINER` lookups return ids only, and append-only tables (audit log, verifications, consents, snapshots) refuse UPDATE/DELETE. `inbound.test.ts` covers RLS and grants on the inbound tables, the alias/contact lookups, the erasure trigger and the outbox sweeper.
- **End-to-end (Playwright):** `npm run test:e2e` — 35 tests mapped to PRD §13: V01-E2E-01..09, V02-E2E-01/03/04/05/06/08, V03-E2E-01..07 (including the first-visit hero journey), V04-E2E-01..08, V06-E2E-01/04/05, plus a 375px responsive/console sweep. All run in the isolated second organisation so the demo data stays untouched; the two clock-moving tests run alone in their own project. Last full run (production build, after the prepared-statement change): 40 passed — 38 in the main project plus the 2 clock tests. **V06-E2E-02 (restore into a fresh database)** is a script, not a Playwright test: `npx tsx --env-file=.env.local scripts/restore-drill.ts` restores `main` at a point in time into a new Neon branch, then checks migrations, RLS, row counts, audit-chain heads and recomputation, snapshot hashes and Ed25519 signatures, and decryption of every stored file; it runs the app from a production build on that branch (Ganga clinician sign-in, a patient ledger, the public `/verify` page), deletes the branch in a `finally` and writes `docs/releases/v1.0/RESTORE-DRILL.md`. Last run: PASS, 14 checks in 74 s (20,074 rows, 43 snapshots, 6 h point-in-time window); procedure and key handling in `docs/RUNBOOK.md`. **V06-E2E-03 (500-event ledger)** is `tests/e2e/v06-perf.spec.ts`: it inserts 500 events with evidence from one uploaded PDF into a fresh Ganga patient and loads the ledger as the clinician (median of three loads, `responseEnd - requestStart`). The budget is `PERF_LEDGER_BUDGET_MS` (default 2000). Before inserting, the test measures the same patient's ledger with a handful of events (the baseline: fixed round trips to the database). Next to the database (`PERF_COLOCATED=true`, i.e. Vercel sin1 + Neon Singapore) it gates the absolute render, which is FR-LED-07 as written; away from it, it gates what the 500 events add. Last run on a production build from a laptop (about 115 ms per round trip to Singapore): baseline 2.3 s, 500-event render 3.6 s, so the 500 events add 1.3 s (passes); HTML 976 kB after trimming client props. The absolute 2 s target has not been measured co-located; with sub-millisecond round trips the baseline shrinks to tens of milliseconds, so the expected total is about 1.4 s. Enabling postgres.js prepared statements (supported by Neon's pooler) cut an 8-query transaction from 1.45 s to 0.41 s on the same link. `tests/e2e/v05-inbound.spec.ts` adds 3 tests (email drop with V05-E2E-07, WhatsApp hold and release, WhatsApp discard/expiry/code budget); it needs the inbound test values in `.env.local` and serves the WhatsApp media from a local HTTP server: 3 passed in 2.5 minutes.
- **Offline capture (V05):** a standalone script that needs a production server (the dev client cannot hydrate from the service-worker cache):

  ```bash
  npx next build && npx next start -p 3100
  BASE_URL=http://localhost:3100 npx tsx --env-file=.env.local tests/e2e/offline-capture.e2e.ts
  ```

## Project layout

- `data/eval/`: hand-authored gold labels (`gold.json`) and the evaluation report (`report.json`).
- `docs/`: `BRIEF.md` (product summary), `PRD.md` (product spec, v1.1), `ARCHITECTURE.md` (build contract and ADRs), `AGENT-RULES.md`.
- `drizzle/`: SQL migrations, including database roles and row-level security.
- `public/`: synthetic demo documents, icons, web manifest and service worker.
- `scripts/`: migrations, base seed, evaluation, synthetic-document generator and icon generator.
- `src/app/`: Next.js App Router pages and `api/` route handlers.
- `src/core/`: pure, deterministic logic (gate, dates, identity, extraction, copy, Radar, ledger). See `src/core/README.md`.
- `src/server/`: server-only code (request wrapper, pipeline, sealing, audit, outbox, admin).
- `src/db/`: Drizzle schema.
- `src/components/` and `src/lib/`: UI components, offline capture and its encryption.
- `src/i18n/`: patient-facing strings in English and Hindi.
- `src/proxy.ts`: security headers and nonce CSP.
- `tests/`: integration (RLS) and E2E specs.

## Known limitations

- **SMS and WhatsApp delivery is built for Twilio but has not been run against Twilio.** Set the `TWILIO_*` variables and the outbox row is delivered after the request commits (retry once on a 5xx). With none set, which is the default and the demo, messages are only recorded (`delivery = simulated`) and the demo phone shows them. Unit tests with a stubbed `fetch` prove the exact request, status updates, retry and that no number is logged. Not proven: acceptance by Twilio's API and the carrier, India DLT sender and template registration (needed for real Indian SMS), WhatsApp template approval, and delivery receipts (`sent` means accepted by Twilio).
- **LLM path proven with a test model, not with a live one.** The AI Gateway returned 403 at the time of writing (no payment method on the Vercel team, per `docs/ARCHITECTURE.md`), and the evaluation ran on the rule-based path only. `src/server/pipeline/llm-path.test.ts` drives the real pipeline over the demo documents with the AI SDK's test model and shows that: verbatim quotes are accepted with gate-computed offsets; fabricated quotes, forbidden fields (`stage`), text hidden in the PDF and unknown event types never reach the record; invalid output gets one retry and then the rule-based result, identical to a rules-only run; a provider failure loses nothing; the model is never called without the patient's `ai` consent, the organisation flag or a provider, nor for a wrong-patient or handwritten document; the request carries only the system prompt, the document text and the response schema (no tools, nothing from the registration record); and the `ai_runs` record holds hashes, ids and numbers, no content. A second test checks the request the real Anthropic adapter would send, with `fetch` stubbed. Still needs a live key: that a real model returns valid and useful `extraction.v1` JSON, LLM precision and recall on the evaluation set, latency and token cost, and that the vendor accepts the request (model id `claude-sonnet-5-5`, structured output) or the Gateway route.
- **OCR accuracy not formally measured.** No character error rate has been measured yet. The PRD §9.4a target for printed reports is 5% or less.
- **Malware check is a signature check.** It detects the EICAR test signature only.
- **Not built.** ABDM integration (`abdm` exists only as a consent purpose). The PRD places it after v1.0.
- **Email drop and WhatsApp intake have not run against Postmark or Twilio.** Tests post the documented payloads, signed or authenticated as the providers do. Not proven: real Postmark and Twilio traffic, a receiving domain (the configured one is a placeholder), and WhatsApp Business sender approval. Vercel limits a request to 4.5 MB, so one mail carries about 3.3 MB of attachments (base64); larger mails are refused by the platform. The sender address of an email is not checked with SPF or DKIM: the 80-bit alias plus a verified sender address is the control. Inline images (signature logos) count as attachments. An expired WhatsApp hold that nobody answers keeps its encrypted files until the next message or the daily cron.
- **Hindi is the only regional language.** Patient-facing strings are in English and Hindi.
- **Radar rules need a recorded clinician review.** The YAML library ships unreviewed (shadow mode). In the demo organisation the seed records a review for nine rules; `RAD-IMG-PT-01` stays in shadow to show the mechanism. The wording still needs review by the team's clinician advisor before any pilot.
- **Erasure runs after the retention period, in the database.** `erase_patient()` (SECURITY DEFINER) refuses unless the request is due, consent is withdrawn and the org matches; it then deletes 20 tables of patient data in one transaction and leaves a PII-free tombstone, the consent history and the audit trail. A daily Vercel cron runs due requests; admins can run them from `/admin/erasure`. Default retention is 10 years (configurable, minimum 3).
- **Voice input uses the browser's Web Speech API** behind an organisation flag; no audio is retained and drug-name WER is unmeasured.
- **Evaluation set is small and not held out.** See the caveats in the Evaluation section.
- **Data location.** The database is in Singapore. `docs/BRIEF.md` §6 prefers India-hosted inference. The LLM hosting choice is an open decision (D12 in `docs/BRIEF.md` §10).
- **No real patient data.** The pilot requires IEC approval first. DPDP obligations apply from 13 May 2027.

Built from PRD v1.1 (docs/PRD.md).

License: All rights reserved. The repository has no LICENSE file.
