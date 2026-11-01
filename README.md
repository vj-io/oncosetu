# OncoSetu

Records continuity for cancer care in India: every displayed fact traces to a verbatim source quote, and referenced documents that are missing from the file are listed.

**Live demo:** https://oncosetu-zeta.vercel.app
Demo mode: sign in with the one-click demo accounts on /login (synthetic data only).

OncoSetu was named OncoBridge in PRD v1.0. "Setu" means bridge. This is an academic and hackathon prototype. A clinician-led pilot requires ethics (IEC) approval before any real patient data is used.

## The problem

- **Records are scattered.** A patient's cancer history sits across hospitals as paper, phone photos and WhatsApp PDFs, and every new centre starts from scratch (see docs/PRD.md §2.4).
- **The volume is large.** About 1.57 million new cancer cases were projected for India in 2025, and National Cancer Grid member centres treat more than 860,000 new patients a year. 55.7% of rural survivors in one study sought a second opinion, and the median travel time to a tertiary centre was 4.3 hours (see docs/PRD.md §2.4 and §4.1).
- **The burden is unmeasured.** We found no Indian study that measures how often outside records are missing at an oncology consultation, or how often tests are repeated for that reason (see docs/PRD.md §2.4). The pilot's measurement study is designed to produce that number.

## What OncoSetu does

The core loop:

1. **Capture.** A desk tablet (multi-page camera), a patient or caregiver upload link protected by OTP, or bulk PDF and photo upload. Handwritten pages are stored as images and are never auto-extracted.
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
| `npx tsx scripts/demo-docs/generate.ts` | Regenerates the synthetic documents and their manifest in `public/demo-docs/` (deterministic) |
| `npx tsx --env-file=.env.local scripts/eval.ts` | Runs the offline evaluation and rewrites `data/eval/report.json`. Add `--llm` for the LLM path |

## Tests

- **Unit (Vitest):** `npm test`. 38 test files under `src/` contain 388 `it` or `test` blocks (static count; `npm test` prints the runner's own total, which also counts `.each` rows). They cover the evidence gate, the date parser, the identity matcher, Radar, the ledger, the copy lint and the pipeline's safety checks.
- **Integration (RLS):** `npm run test:integration`, which needs a live database. `tests/integration/rls.test.ts` has 6 tests. They check that the app role has no BYPASSRLS; that no rows are visible without `app.org_id`; that cross-organisation reads, updates and deletes are denied; that cross-organisation writes are rejected by WITH CHECK; that `SECURITY DEFINER` lookups return ids without exposing rows; and that the audit-log trigger blocks UPDATE and DELETE even for the owner.
- **End-to-end (Playwright):** The PRD §13 scenario IDs (V01–V06) define the intended E2E coverage. The repository has one spec, `tests/e2e/offline-capture.e2e.ts`, which covers V05-E2E-01 to 05 (offline capture). It needs a production build and a demo database, and it cannot run on `next dev`:

  ```bash
  npx next build && npx next start -p 3100
  BASE_URL=http://localhost:3100 npx tsx --env-file=.env.local tests/e2e/offline-capture.e2e.ts
  ```

  The repository has no Playwright config and no npm script for E2E yet.

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

- **No SMS or WhatsApp provider.** The outbox stores messages (masked number and HMAC) and sends nothing. The demo shows a simulated phone when `DEMO_MODE=true`.
- **LLM path not tested live in this deployment.** The AI Gateway returned 403 at the time of writing (no payment method on the Vercel team, per `docs/ARCHITECTURE.md`). The evaluation ran on the rule-based path only.
- **OCR accuracy not formally measured.** No character error rate has been measured yet. The PRD §9.4a target for printed reports is 5% or less.
- **Malware check is a signature check.** It detects the EICAR test signature only.
- **Not built.** ABDM integration (`abdm` exists only as a consent purpose) and email or WhatsApp intake. The PRD places both after v1.0.
- **Hindi is the only regional language.** Patient-facing strings are in English and Hindi.
- **Radar rules are unreviewed.** They run in shadow mode until a clinician reviews them.
- **Evaluation set is small and not held out.** See the caveats in the Evaluation section.
- **Data location.** The database is in Singapore. `docs/BRIEF.md` §6 prefers India-hosted inference. The LLM hosting choice is an open decision (D12 in `docs/BRIEF.md` §10).
- **No real patient data.** The pilot requires IEC approval first. DPDP obligations apply from 13 May 2027.

Built from PRD v1.1 (docs/PRD.md).

License: All rights reserved. The repository has no LICENSE file.
