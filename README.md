# OncoSetu

Records continuity for cancer care in India: every displayed fact traces to a verbatim source quote, and referenced documents that are missing from the file are listed.

**Live demo:** https://oncosetu-zeta.vercel.app
Demo mode: sign in with the one-click demo accounts on /login (synthetic data only). A 6-minute judge walkthrough is in [docs/DEMO.md](docs/DEMO.md); design choice, model delegation and verification evidence are in [docs/BUILD-REPORT.md](docs/BUILD-REPORT.md).

OncoSetu was named OncoBridge in PRD v1.0. "Setu" means bridge. This is an academic and hackathon prototype. A clinician-led pilot requires ethics (IEC) approval before any real patient data is used.

## The problem

- **Records are scattered.** A patient's cancer history sits across hospitals as paper, phone photos and WhatsApp PDFs, and every new centre starts from scratch (see docs/PRD.md §2.4).
- **The volume is large.** About 1.57 million new cancer cases were projected for India in 2025, and National Cancer Grid member centres treat more than 860,000 new patients a year. 55.7% of rural survivors in one study sought a second opinion, and the median travel time to a tertiary centre was 4.3 hours (see docs/PRD.md §2.4 and §4.1).
- **The burden is unmeasured.** We found no Indian study that measures how often outside records are missing at an oncology consultation, or how often tests are repeated for that reason (see docs/PRD.md §2.4). The pilot's measurement study is designed to produce that number.

## What OncoSetu does

The core loop:

1. **Capture.** A desk tablet (multi-page camera), a patient or caregiver upload link protected by OTP, bulk PDF and photo upload, a per-patient email drop address, or WhatsApp forwarding confirmed with a one-time code (see Inbound channels). Handwritten pages are stored as images and are never auto-extracted.
2. **Evidence-gated extraction.** Extraction proposes events, each with a quote. A deterministic gate accepts only quotes found verbatim in the page text, checks that fields and dates appear in that quote, and checks identity per document. Event, document and received dates are kept separate. Quotes are whole sentences. Besides record events, it lists allergy statements, follow-up dates already written down (review visit, suture removal) and lab result rows as printed, never interpreted. A document's own diagnosis section and history sentences are copied word for word as staff-only facts (clinician tier, hidden from the desk, never shown to patients or in share links); nothing is parsed out of them.
3. **Document index and timeline.** Each item shows what it says, where (page and quote), who verified it and when. Records staff verify against the source. A clinician sees key items and conflicts.
4. **Missing-Record Radar.** Deterministic rules on documented events list referenced documents that are not in the file, for example "histopathology report not in file" for an excision documented on a given date. It is a document-completeness checklist. Rules run in shadow mode until a clinician reviews them.
5. **Records Request Kit.** English and Hindi request letters, tracked through states, with reminders at 7 and 21 days and an escalation information sheet. The letters make no deadline promise.
6. **Change Ledger and sealed snapshots.** A returning visit is compared with the last sealed snapshot: new since last visit, newly received older records, amended, conflicts, what the patient said, missing items, and suppressed duplicates. A sealed snapshot is hashed (SHA-256 over canonical JSON) and signed with Ed25519. It prints as an A4 passport (`/print/passport/[id]`) with the hash, the key id and a QR code to `/verify/[id]`, and `scripts/verify-snapshot.ts` checks a downloaded snapshot offline against `/api/keys`. A date that could be read either way (05/06) shows both readings until records or a clinician picks one.
7. **Share links.** Passcode-protected, expiring and revocable. The payload is encrypted in the browser, and the key sits in the URL fragment, so it never reaches the server. The viewer needs no account and sees "Document index, not a clinical summary" together with the documents that are not in the file.

Around the loop:

- **Patient and caregiver portal:** OTP sign-in, caregiver-primary accounts, and pre-visit questions answered by tap or by voice, with text read-back. Voice goes to Sarvam (`saaras:v4`, with the patient's own medicines and hospitals as keyterms); the recording is kept encrypted beside the answer for records and clinicians to play. Spoken read-back (Sarvam `bulbul:v3`) is offered only when the hospital turns it on and the diagnosis has been disclosed. A desk-station mode (`/p/login?station=1`) runs the questions on a clinic tablet that signs itself out. Home shows only what the papers say: papers received, papers not in the file with where to ask (the hospital or lab that mentioned them), the doctor named on the latest papers, and dates already written down (next visit, suture removal); no treatment choices or outcomes. The send page leads with forwarding from WhatsApp or email. Languages: English, Hindi and Hinglish (Hindi in Roman script) on patient pages, share links and patient SMS; letters to hospitals stay English or Hindi. Before sign-in, the portal, share links and the public verify page open in Hindi when the browser prefers Hindi; after sign-in, the patient's own language applies.
- **Offline desk capture (PWA):** an encrypted local queue that syncs when the network returns.
- **PM-JAY pre-auth file (9 Nov):** a patient tab for the insurance desk (records, clinicians, administrators). For chemotherapy, surgery or radiotherapy it lists the documents NHA's oncology Standard Treatment Guidelines (prepared with Tata Memorial Hospital and the National Cancer Grid) ask for before pre-authorisation and for the claim, each marked in the file, not in the file, or not a paper OncoSetu holds (the signed treatment plan approval form, drug bar codes). A document not in the file that the missing-papers list is already chasing says which hospital to ask. Printable. Document completeness only: it does not judge eligibility or choose a package (`src/core/preauth.ts`).
- **Admin console:** rule review, the audit-chain view, metrics, and the measurement study.
- **ABDM pull (J6, FR-ING-ABDM-01/02):** records staff request FHIR records linked to the patient's ABHA, the patient approves in the portal, and the encrypted bundles become structured facts (`external_structured`, evidence = the FHIR resource) that feed the ledger and the Radar. Runs against an in-process consent manager and HIP (see ABDM below).

## Safety by design

### Evidence gate

Every displayed fact must trace to a verbatim source quote. The gate rejects a candidate whose quote is not found in the page text (`quote_not_found`), whose field or date does not appear in the quote (`field_not_in_quote`, `date_not_in_quote`), or whose field or event type is not allowed. Quotes must be 8 to 300 characters. The rule-based and LLM paths pass through the same gate.

The gate does not catch every error. PRD §9.4a sets out what it covers:

| Error class | Caught by the gate? | Control |
|---|---|---|
| Fabricated fact | Yes: the quote is not found | Gate. Unsupported facts reaching the record: 0 on both eval sets (60 documents) |
| Omission | No | Clinician-abstracted gold set; per-class recall reported to verifiers |
| Right quote, wrong field, date or patient | No, partly | Binding checks (FR-EXT-09), `binding_uncertain` flag, per-document identity check |
| Faithfully quoted OCR error | No | Span-confidence flag below 0.80; low-confidence spans are always human-verified |
| Prompt injection changing output | Partly | Forbidden fields are rejected; the model has no tools |
| Wrong document type | No | Human tagging on low confidence |

The only claim made is that every displayed fact is traceable to a verbatim source quote.

#### Quote-only oncology lines (7 November 2026)

Six event types hold a sentence or table row copied word for word, taken by the rule extractor only (staff-only, clinician tier, like the diagnosis section): `stage_documented` (the TNM or stage words), `marker_results_documented` (ER, PR, HER2, Ki-67, mismatch-repair and other result rows of an IHC or molecular table), `margins_documented` (the sentence that names a margin), `impression_documented` (an impression or interpretation block), `addendum_documented` (what an addendum says about its report) and `regimen_documented` (a "Regimen" or "Protocol" line not already on a cycle record). Allow-listed fields: `section_text` (stage and impression), `marker_text`, `margins_text`, `addendum_text`, `regimen_text`, plus the institution and date fields. The field is called `section_text`, not `stage_text` or `impression_text`, because the gate refuses field names that say stage or impression. The gate is unchanged: the quote must be found verbatim, 8 to 300 characters, and every field value must sit inside it. Nothing is inferred: a document with no such line gets no such fact, and text that tries to give the software orders is skipped. The language model cannot emit these types (the schema leaves out staff-only types).

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
| Speech (optional) | Sarvam `saaras:v4` speech-to-text with keyterms, `bulbul:v3` read-back (`src/server/voice/`, behind `AsrProvider`) |
| Other | zod 4, qrcode, yaml, uuid (UUIDv7), pdf-lib (consent PDFs, stripping active PDF content) |
| Tests | Vitest 5 (unit and integration), Playwright (E2E) with `@axe-core/playwright` (WCAG 2.2 AA scan) |
| Hosting | Vercel, Fluid compute, Node runtime, region `sin1` (`vercel.json`) |

### Deviation from the PRD (ADR-001a)

`docs/ARCHITECTURE.md` (ADR-001a) supersedes PRD §8.1 for the prototype:

- One Next.js app is the only deployable, instead of Next.js, FastAPI and a Procrastinate worker.
- A Postgres-backed state machine replaces the job queue. A stale `processing` lock is re-claimed by the next status poll or by the reprocess action.
- tesseract.js 7 replaces PaddleOCR. The `OcrProvider` interface (`src/server/pipeline/text.ts`, `docs/ADR/ADR-016-provider-interfaces.md`) keeps cloud document AI swappable.
- Files are stored as encrypted `bytea` in Postgres instead of object storage. The ceiling is a few GB, and object storage is needed before the pilot.
- Staff sign-in uses scrypt passwords and TOTP, and patient sign-in uses OTP, both implemented in the app. PRD §8.1 named Supabase Auth.
- The pipeline is TypeScript, not Python. Its logic is pure functions in `src/core`.
- Hosting is Vercel with the database in Neon, Singapore. PRD §8.1 allowed India or Singapore regions.

### LLM extraction (Gemini free tier, rate-limited)

The deployment uses Google's Gemini API on the free tier: `GOOGLE_GENERATIVE_AI_API_KEY`, model `GEMINI_MODEL` (default `gemini-3.5-flash-lite`) with `GEMINI_FALLBACK_MODELS` (default `gemini-flash-lite-latest`) tried when the primary answers 503. Because one free key serves every organisation and every serverless instance, each call first takes a slot from a **shared budget in Postgres** (`llm_reserve()`, `drizzle/0011_llm_quota.sql`): default 8 calls a minute and 200 a day (`LLM_RPM`, `LLM_RPD`, below the free-tier limits), counted on Google's quota day (midnight US Pacific). The SDK's own retries are off; a provider 429 starts a 60 s cooldown for every instance (`LLM_COOLDOWN_S`). No slot means no call: the document is extracted by the rule-based path and its page says why. `/admin/settings` shows calls this minute and today; `vercel crons run /api/cron/llm-health` proves the model answers from the deployment (one synthetic call, no patient data) and `scripts/llm-health-report.ts` lists the recorded calls.

On the free-tier model the LLM **augments** the rule library instead of replacing it: both sets of candidates go through the same evidence gate and are de-duplicated after it, so the model can add facts but never remove one the rules find. Gemini's response-schema dialect rejects `const` and length bounds, so it receives a sanitised copy of `extraction.v1` and the full schema validates its answer item by item. With `ANTHROPIC_API_KEY` (or the Vercel AI Gateway with `AI_ENABLED=true`) the LLM replaces the rules, as the PRD describes. Every path also requires the organisation's `ai_extraction` flag and the patient's consent for purpose `ai`, both checked on each use; with neither, the app runs fully on the deterministic extractor.

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

## ABDM pull (J6)

FR-ING-ABDM-01/02, PRD v1.1. Code in `src/server/abdm/**` (transport, crypto, consent gate, flow), `src/core/fhir/**` (pure FHIR mapping), tables in `drizzle/0009_abdm.sql`.

- **Flow.** On the patient's Documents tab (records officer or clinician) the ABDM panel requests HI types (diagnostic reports, discharge summaries, OP consultations, prescriptions) for a date range: `POST /api/patients/[id]/abdm/consent-requests`. It needs the patient's consent purpose `abdm` (403 `consent_required` otherwise) and an ABHA number captured at registration. The consent manager notifies the patient (a neutral SMS with a link to `/p/abdm`); the patient or acting caregiver approves or declines there (`POST /api/p/abdm/[requestId]`), which stands in for the ABHA/PHR app. On GRANTED the HIU fetches the artefact, sends a health-information request with a fresh X25519 key and nonce, and the HIP pushes encrypted entries. OncoSetu re-checks consent on use (its own `store` + `abdm` purposes, then the artefact: GRANTED, before its erase-at, this patient's ABHA, the requested HI types and date range) and only then decrypts. One bad entry (tag, key, nonce or MD5 checksum) refuses the whole push: the transfer is marked FAILED and nothing else is written.
- **Mapping.** DiagnosticReportRecord → imaging / pathology / lab report events by category or LOINC; DischargeSummaryRecord → admission and discharge (Encounter) and procedures; OPConsultRecord → consultation (doctor, department, date); PrescriptionRecord → prescription with medicine names only. Names, institutions and dates are copied from the resources; Condition stage, Observation values, report conclusions and dosage are never read, and each event passes the evidence gate's field rules (forbidden inference fields, per-type allow-list). Each bundle is stored encrypted as a document (`intake_route = abdm`, `application/fhir+json`, `doc_type` from the record type) so it appears in the document index; its events carry `source_type = external_structured`, `extraction_method = structured_map` and evidence `fhir_resource_ref` (`DiagnosticReport/<id>`, `Procedure/<id>`, `Encounter/<id>`, `Composition/<id>#<section code>`) with the SHA-256 of the canonical resource JSON in place of a quote hash. The Radar is recomputed. The source viewer shows each fact beside its FHIR resource; the ledger labels them "ABDM record · Structured".
- **Crypto.** ABDM/Fidelius scheme with `node:crypto`: X25519 shared secret; XOR of the two 32-byte nonces; HKDF-SHA256 (salt = first 20 bytes of the XOR, empty info, 32-byte key); AES-256-GCM with IV = last 12 bytes of the XOR; content = base64(ciphertext ‖ tag). Key material uses the documented `dhPublicKey { expiry, parameters, keyValue }` structure. Only SHA-256 hashes of the exchanged keys and nonces are stored; the HIU private key lives in memory for the transfer.
- **Erase (PRD §10.5).** Revoking in the portal, or the artefact's erase-at passing (30 days after the request), removes every document, file, event (all versions), evidence row, verification and Radar link the request brought in, through `abdm_erase()` (SECURITY DEFINER; refuses unless revoked or due in real time, and across organisations). The daily `GET /api/cron/abdm-erase` (Bearer `CRON_SECRET`) sweeps every org, and reading the ABDM panel, the portal page or an ABDM source view runs the same check for that patient first.
- **Gateway.** `AbdmTransport` (`src/server/abdm/transport.ts`) has two implementations: `InProcessGateway`, the default with no `ABDM_*` env, an in-process consent manager plus a HIP that holds the synthetic bundles in `data/abdm/` (FHIR R4, NRCeS profile structure, marked synthetic) for two ABHA numbers (`00-1111-2222-0001`, `00-1111-2222-0002`, the Ganga test identities) and really encrypts; and `SandboxGateway`, enabled by `ABDM_CLIENT_ID` + `ABDM_CLIENT_SECRET` + `ABDM_BASE_URL` (optional `ABDM_HIU_ID`, `ABDM_CM_ID`), an HTTP client for the v3 HIU gateway calls (session token, `REQUEST-ID` / `TIMESTAMP` / `X-CM-ID` / `X-HIU-ID`).

## Evaluation

`scripts/eval.ts` runs the same pipeline code as the server over two synthetic sets and compares the output with hand-written gold labels. An extracted event counts as correct when it matches at least one gold fact on type, date and text.

- **Tuned set:** the 20 demo documents in `public/demo-docs/` (gold: `data/eval/gold.json`). The rule library was developed on these, so its numbers are optimistic.
- **Held-out set:** 40 documents in `data/eval/heldout/` (gold: `data/eval/gold-heldout.json`): 10 new patients, about 30 invented institutions, all 13 document types, 3 handwritten prescriptions, Hindi and bilingual pages, photographed pages, 2 wrong-patient headers and 1 prompt-injection line. They were written after the rules were frozen and the rules have not been tuned on them.
- Reports: `data/eval/report.json` (rules, 5 November 2026) and `data/eval/report-llm.json` (rules + Gemini `gemini-3.5-flash-lite`, hybrid mode, 4 November 2026, before the 5 November extractor changes: 58 calls through the shared budget, 52 ok and 6 provider errors that fell back to the next model or to the rules). The admin metrics page shows both against the PRD thresholds.
- Only event types that a set's gold labels at all are scored. The types added on 5 and 6 November (allergy statements, follow-up dates, lab result rows, diagnosis sections, history sentences) are still not labelled: they are counted, pass the hard gates, and are scored once someone labels them. The six types added on 7 November are labelled and scored.

**9 November: a second blind set.** `data/eval/heldout2/` holds 24 new documents (6 patients, 110 gold facts; gold `data/eval/gold-heldout2.json`), written on 9 November by a separate author: an AI assistant working without access to the rules, which read only the document generator and the labelling convention. It weights the types the held-out set found weakest: consultation notes, radiotherapy summaries, operation notes, discharge summaries with medicine lists and histopathology. Before it ran, the rules were fixed for the held-out set's misses (commit `3ce6279`), so the held-out set is now a second look, not a blind one.

| PRD §9.5 metric | Target | Tuned · rules | Held-out · rules (second look) | New blind set · rules, blind run | New blind set · rules after its fixes (second look) | New blind set · rules + Gemini, blind run |
|---|---|---|---|---|---|---|
| Unsupported facts reaching the record | 0 | 0 | 0 | 0 | 0 | 0 |
| Handwritten pages auto-extracted | 0 | 0 | 0 | 0 | 0 | 0 |
| Event precision | ≥ 0.95 | 0.983 | 1.000 | 0.785 | 0.812 | 0.788 |
| Event recall (omission) | ≥ 0.85 | 0.973 | 0.969 | 0.691 | 0.755 | 0.691 |
| Classification macro-F1 | ≥ 0.85 | 1.000 | 1.000 | 0.820 | 0.926 | 0.820 |
| Identity decision as expected | held, never wrong | 20 / 20 | 28 / 40 | 19 / 24 | 19 / 24 | 19 / 24 |

What it found. Rules fixed on one set's misses did not carry over to new layouts: blind recall stayed at about 0.7 (0.709 on the first held-out set, 0.691 here). AI-assisted reading (Gemini `gemini-3.5-flash-lite`, hybrid mode, 22 calls, all ok; `data/eval/report-llm-heldout2.json`) added nothing on this set. Precision fell below target too, mostly from procedure mentions: one operation counted as several items, and a planned operation ("tentatively on …") counted as done. No document was attached to the wrong patient: 4 true documents were held for a person and 1 was blocked as a name mismatch. OCR character error rate over all 11 printed photo pages of the three sets: 7.5% mean, 10.8% worst.

The fixes it led to (commit `94a1ece`, so the right-hand rules column is a second look): one procedure item per sentence, planned-surgery words, tab-separated "Operation performed" labels, upper-case medicine tables (TAB., SYP., INJ.), and a one-word heading line such as "Rx" counted as a title. The plan for layouts no set has seen is per-site tuning during the pilot's shadow weeks, before anything is shown to staff.

The record as of 8 November follows.

| PRD §9.5 metric | Target | Tuned · rules | Held-out · rules, untouched labels | Held-out · rules, after adding oncology fact types (rules tuned using some of these documents) | Held-out · rules + Gemini (4 Nov, older) |
|---|---|---|---|---|---|
| Unsupported facts reaching the record | 0 | 0 | 0 | 0 | 0 |
| Handwritten pages auto-extracted | 0 | 0 | 0 | 0 | 0 |
| Event precision | ≥ 0.95 | 0.983 | 0.915 | 0.935 | 0.907 |
| Event recall (omission) | ≥ 0.85 | 0.973 | 0.709 | 0.760 | 0.734 |
| Classification macro-F1 | ≥ 0.85 | 0.947 | 0.983 | 0.983 | 0.983 |
| Identity decision as expected | held, never wrong | 20 / 20 | 27 / 40 | 27 / 40 | 27 / 40 |

How to read the held-out columns. **Untouched labels** (79 facts) scores only the labels that existed before the oncology fact types were added: stage, marker results, margins, impression, addendum and regimen are left out on both sides, so this column is the honest held-out figure. **After adding oncology fact types** (96 facts) includes the 17 new labels; the rules for those six types were tuned using some of these held-out documents, so that column is optimistic and is not a blind result. `scripts/eval.ts` writes both: the main numbers include the new types and `untouchedLabels` holds the other figures, and the admin evaluation panel shows both columns with these same labels. The tuned column is optimistic as always (the rules were developed on those documents; on its labels before the new types it scores 0.976 / 0.963).

The rules + Gemini column is the 4 November run, before the 7 November changes, and has not been re-run (no provider key in this build): tuned set precision 0.952, recall 0.981; held-out precision 0.907, recall 0.734. The two rules columns are the 7 November run.

**7 November changes (oncologist audit).** Six quote-only fact types were added for the lines an oncologist looks for first (see "Quote-only oncology lines" under the evidence gate): stage as written, marker result rows, margins, an impression, addendum text and the regimen line. Their gold labels were added the same day (tuned 19 and held-out 17 new gold facts, plus the urea cream line in the tuned set: gold 53 to 73 and 79 to 96), so they are now scored. Three extraction fixes ride in the same run: every numbered line of a printed prescription table is indexed (before, the table was read only when each line began with Tab./Cap./Inj., so the urea cream and, with the numbering as printed in the PDF, the whole table were dropped; the urea cream was also missing from the gold), a date that sits on the line after "... done on" now stays with its sentence, and a next-visit line that says "done one day before" after its date is no longer discarded as a past event. Before / after on the rules path:

| Set | Precision before | Precision after | Recall before | Recall after |
|---|---|---|---|---|
| Tuned (20 documents) | 0.950 | 0.983 | 0.943 | 0.973 |
| Held-out (40 documents) | 0.911 | 0.935 | 0.658 | 0.760 |

On the labels that existed before the new types (the `untouchedLabels` figures in `report.json`) the same code gives held-out precision 0.915 and recall 0.709 (tuned 0.976 / 0.963), so most of the held-out recall gain is the prescription, date and follow-up fixes, and the rest is the new types now being labelled. The new types were hand-labelled by reading each document, and the held-out labels were written after the held-out rules had been frozen for the older types but not for the new ones: the new rules were tuned on the held-out documents that carry those lines (markers, impressions, regimen). Treat the held-out gain on those types as optimistic. Hard gates on both sets: unsupported facts reaching the record 0, handwritten pages auto-extracted 0.

**5 November changes (mentor review).** Quotes are now whole sentences, joined across wrapped lines: a fact never starts mid-sentence. Before, the CT fact quoted "drug allergies. CT thorax …", which reads as if the patient had allergies when the page says "No known drug allergies". That moved the rules numbers from tuned 0.949 / 0.962 and held-out 0.889 / 0.646 to the figures above. Two tuned gold labels were revised (`about` in `gold.json` says why). One tuned fact is now missed: "Specimen sent for histopathology" had only ever been matched by accident, through the old line-long quote of the IHC fact.

**OCR character error rate** (FR-DOC-02, target ≤ 5% on printed pages): 7.9% mean, 10.8% worst, over the 9 printed photographed pages of both sets (handwritten pages excluded; only whitespace is normalised). Below target. The errors come from shadow and noise on phone photos; tesseract `eng+hin` also read that noise as Devanagari on English pages, so a page without a confidently read Devanagari word is now read again with `eng` alone (9.4% → 7.9%). FR-EXT-10 is the control for what remains: spans below 0.80 confidence are shown beside the page image and cannot be bulk-verified.

Held-out recall by document type (shown to verifiers as the coverage note, FR-EXT-08; target ≥ 0.85):

| Type | Gold facts | Rules | Rules + Gemini |
|---|---|---|---|
| Discharge summary | 30 | 0.700 | 0.800 |
| Printed prescription | 16 | 1.000 (was 0.813) | 0.813 (4 Nov) |
| Pathology report | 8 (was 7) | 0.625 (was 0.571) | 0.571 (4 Nov) |
| Lab report | 5 | 1.000 | 1.000 |
| IHC / molecular report | 13 (was 4) | 0.923 (was 0.750) | 0.750 (4 Nov) |
| Imaging report | 8 (was 4) | 1.000 | 1.000 (4 Nov) |
| Consultation note | 4 (was 3) | 0.250 (was 0.000) | 0.000 (4 Nov) |
| Chemotherapy day-care record | 5 (was 3) | 0.800 (was 0.667) | 0.667 (4 Nov) |
| Procedure / operative note | 3 | 0.000 | 0.667 |
| Radiotherapy summary | 2 | 0.000 | 0.000 |
| Other | 2 | 0.000 | 0.500 |

What the held-out set found:

- **A safety failure, fixed.** The first blind run auto-extracted one handwritten prescription: black ink, 0.31 of its lines below 0.75 confidence, just under the classifier's bar, so it was treated as printed (and its date misread as 2006). Borderline pages are now held when the whole page also reads below 0.80 confidence. That run is kept in `data/eval/heldout-blind-run.json`; the handwriting result on the held-out set is no longer blind.
- **Identity holds too many documents.** 13 held-out documents that belong to the patient came back `insufficient` (7 `name_missing`, from headers such as "Patient: X, 55 Y / M" and Hindi or bilingual headers; 6 `no_corroborating_field`). Safe, since they wait for a person, but it costs coverage. Both wrong-patient documents were caught.
- **Recall is the weak point.** Consultation notes and radiotherapy summaries are not extracted; pathology reports reach 0.57. Some consultation misses are partly strict gold labels (the right type and date, but no doctor or department in the quote).
- The prompt-injection line was flagged and no forbidden field reached a draft.
- Earlier, the model on its own (replacing the rules) reached precision 0.71 and recall 0.23 on the tuned set: it merged several prescription lines into one item with a letterhead quote, which the gate refused. That is why the free-tier model augments the rules.

Caveats:

- Both sets are synthetic and authored by the team; the clinician advisor has not reviewed the gold labels. Per-type counts are small (1 to 30 facts), so per-type recall is noisy.
- The eval scores a held document as if a person attached it, which is when production extracts it.
- PRD §9.5 also names a 200-pair identity set and 150 date strings: those live in the unit tests (`src/core/identity/identity.test.ts`, 360 generated pairs, mismatch recall 100%; `src/core/dates/dates.test.ts`, ≥ 150 cases). The 30-document adversarial set and the 20-page handwritten set are not built: the two sets hold 2 injection documents and 4 handwritten pages.

Rerun with `npx tsx --env-file=.env.local scripts/eval.ts` (tuned, held-out and the second blind set; `--set tuned|heldout|heldout2` for one, written to `report-<set>.json`; `--llm` for the Gemini path). It exits with code 1 if a hard gate fails. Regenerate the held-out documents with `npx tsx scripts/demo-docs/generate-heldout.ts`.

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
| `SIGNING_KEYS_RETIRED` | Optional JSON `{"<old key id>": "<base64 SPKI PEM>"}` of rotated-out public keys, so old seals still verify (RUNBOOK §3) |
| `DEMO_MODE` | Set to `true` to enable the demo accounts, the simulated phone outbox and the demo clock |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Optional. Real SMS and WhatsApp delivery through Twilio. Also needs a sender, below |
| `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | Optional. SMS sender (the Messaging Service wins if both are set) |
| `TWILIO_WHATSAPP_FROM` | Optional. WhatsApp sender; without it WhatsApp messages stay simulated |
| `INBOUND_EMAIL_USER`, `INBOUND_EMAIL_PASSWORD` | Optional. HTTP Basic credentials Postmark sends to `/api/inbound/email`; unset → 503 |
| `INBOUND_EMAIL_DOMAIN` | Optional. Domain of the per-patient drop addresses (MX pointing at Postmark); unset → email drop off |
| `WHATSAPP_INTAKE_NUMBER` | Optional. The WhatsApp number patients forward reports to, shown on the patient's send page once WhatsApp intake is on (`TWILIO_AUTH_TOKEN` + `PUBLIC_BASE_URL`); unset → "not switched on yet" |
| `PUBLIC_BASE_URL` | Optional. Public origin Twilio calls (e.g. `https://oncosetu-zeta.vercel.app`), used to check `X-Twilio-Signature`. With `TWILIO_AUTH_TOKEN` it turns on `/api/inbound/whatsapp`; either unset → 503 |
| `CRON_SECRET` | Bearer secret Vercel Cron sends to `/api/cron/*` (erasure, inbound holds, outbox sweeper, backup) |
| `BACKUP_KEY` | Base64, 32 bytes. Encrypts the daily backups (AES-256-GCM). Losing it makes every backup unreadable; see `docs/RUNBOOK.md` |
| `BACKUP_KEY_PREVIOUS` | Optional. The key before a rotation, so older backups stay readable until they expire |
| `BLOB_READ_WRITE_TOKEN` | Token of the private Vercel Blob store `oncosetu-backups` (set by `vercel blob create-store`); unset → `/api/cron/backup` answers 503 |
| `BACKUP_RETENTION_DAYS` | Optional, default 35. Older backups are deleted after each successful backup; the 7 newest always stay |
| `ANTHROPIC_API_KEY` | Optional. LLM via Anthropic |
| `AI_ENABLED`, `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | Optional. LLM via Vercel AI Gateway |
| `SARVAM_API_KEY` | Optional. Sarvam speech for pre-visit answers on `/p/visit`: speech-to-text (`saaras:v4` with keyterms) when the organisation's `voice` flag is on, and spoken read-back (`bulbul:v3`) when its `tts` flag is on and the patient's disclosure is cleared. Unset → the browser's own recogniser and voice |
| `SARVAM_BASE_URL` | Optional. Replaces `https://api.sarvam.ai`; the voice E2E points it at a local stub (`http://127.0.0.1:4010`) |
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
| `npx tsx --env-file=.env.local scripts/eval-asr.ts` | Voice drug-name evaluation: 50 synthetic Sarvam TTS clips transcribed with and without keyterms, writes `data/eval/asr-report.json` (`--rescore` re-scores without API calls) |
| `npx tsx --env-file=.env.local scripts/perf-pipeline.ts [--since=ISO]` | Read-only: per-page processing median/p95 and per-batch times from document and audit timestamps |
| `npx tsx scripts/verify-snapshot.ts <snapshot.json> <keys.json \| https://host/api/keys>` | Offline tamper check of a downloaded sealed snapshot: prints OK or TAMPERED |
| `npx tsx --env-file=.env.local scripts/backup.ts` | Encrypted backup of the whole database to the private Blob store now, plus retention (the same code as the daily cron `/api/cron/backup`) |
| `npx tsx --env-file=.env.local scripts/restore-from-backup.ts --blob <pathname\|latest>` | Restores a backup into a fresh Neon branch, verifies it and deletes the branch (`--keep-branch` keeps it); writes `docs/releases/v1.0/BACKUP-RESTORE.md` |

## Tests

- **Unit (Vitest):** `npm test` — 89 files, 1,340 tests, including the copy lint over every screen, the RBAC table for every API handler, the red-team set and the eval regression guard (earlier rounds added ABDM crypto vectors, consent gate, FHIR mapping, backup envelope and retention). They cover the LLM extraction path with the AI SDK's test model, SMS/WhatsApp delivery with a stubbed `fetch`, the evidence gate (including property tests that no accepted quote is anything but an exact slice of its page), the India-first date parser, the transliteration-aware identity matcher (360 labelled pairs: mismatch recall 100%, false-match 0%), the Radar engine and merge rules, the ledger diff, seal hash/signature tamper detection, request reminders, share crypto and signatures, copy lint over every patient-facing string, the pipeline's upload safety checks, and the inbound channels (Twilio signature known-answer vector, Postmark parsing, the WhatsApp hold state machine).
- **Integration (RLS):** `npm run build && npm run test:integration` (needs a live database; 17 files, 79 tests, including the strict backlog order, original-file immutability, cross-org identity, the requests cron, per-org LLM budgets and a log-redaction run against `next start`) — `rls.test.ts` (10 tests) proving, as the app role, that nothing is visible without `app.org_id`, cross-organisation reads/updates/deletes/inserts are denied, `SECURITY DEFINER` lookups return ids only, and append-only tables (audit log, verifications, consents, snapshots) refuse UPDATE/DELETE. `inbound.test.ts` covers RLS and grants on the inbound tables, the alias/contact lookups, the erasure trigger and the outbox sweeper. `abdm.test.ts` covers the ABDM transfer (tampered ciphertext writes nothing) and `backup-jsonl.test.ts` the backup type round trips. `erasure.test.ts` covers the erasure executor (refused before the retention date, with active consent or across organisations; then a full purge with a PII-free tombstone and an intact audit chain). `backup-jsonl.test.ts` round-trips bytea, jsonb, json, timestamptz (microseconds), date, an enum, uuid[], real, numeric, bigint, text with control characters, JSON `null` and SQL NULL through the backup's JSON-lines format on session-local temp tables, and checks a second export is byte-identical. 27 tests in total (6 files, run one at a time; `llm-quota.test.ts` proves 12 concurrent reservations never exceed the per-minute budget).
- **Backups (PRD §10.2):** unit tests in `src/server/backup/backup.test.ts` (12): the AES-256-GCM envelope round-trips at any chunk size and fails on any changed byte (data, tag, IV, header), on a wrong key (naming the key the file needs) and when truncated; the file's tables are checked against its manifest (count and SHA-256); retention keeps 35 days and always the 7 newest, and never selects objects that are not backups. The real restore is a script: `scripts/restore-from-backup.ts --blob latest` downloads the newest backup, verifies it, loads it into a fresh Neon branch in one transaction and proves it (row counts and re-export SHA-256 per table equal to the manifest, audit chains, snapshot signatures, file and name decryption, migrations), then deletes the branch. Last run: see `docs/releases/v1.0/BACKUP-RESTORE.md`.
- **End-to-end (Playwright):** `npm run test:e2e` — 98 tests in three projects (main, webkit, clock); 8 Nov run on a production build: 98 of 98 passed (75 in Chromium, 16 in WebKit, 7 clock-moving tests; the a11y test and the clock project were rerun after a test-only fix to the RBAC sweep). Mapped to PRD §13: V01-E2E-01..09, V02-E2E-01/03/04/05/06/08, V03-E2E-01..07 (including the first-visit hero journey), V04-E2E-01..08, V06-E2E-01/04/05, plus a 375px responsive/console sweep. All run in the isolated second organisation so the demo data stays untouched; the two clock-moving tests run alone in their own project. (An earlier full run on 2 Nov 2026 had 42 tests.) **V06-E2E-02 (restore into a fresh database)** is a script, not a Playwright test: `npx tsx --env-file=.env.local scripts/restore-drill.ts` restores `main` at a point in time into a new Neon branch, then checks migrations, RLS, row counts, audit-chain heads and recomputation, snapshot hashes and Ed25519 signatures, and decryption of every stored file; it runs the app from a production build on that branch (Ganga clinician sign-in, a patient ledger, the public `/verify` page), deletes the branch in a `finally` and writes `docs/releases/v1.0/RESTORE-DRILL.md`. Last run: PASS, 14 checks in 74 s (20,074 rows, 43 snapshots, 6 h point-in-time window); procedure and key handling in `docs/RUNBOOK.md`. **V06-E2E-03 (500-event ledger)** is `tests/e2e/v06-perf.spec.ts`: it inserts 500 events with evidence from one uploaded PDF into a fresh Ganga patient and loads the ledger as the clinician (median of three loads, `responseEnd - requestStart`). The budget is `PERF_LEDGER_BUDGET_MS` (default 2000). Before inserting, the test measures the same patient's ledger with a handful of events (the baseline: fixed round trips to the database). Next to the database (`PERF_COLOCATED=true`, i.e. Vercel sin1 + Neon Singapore) it gates the absolute render, which is FR-LED-07 as written; away from it, it gates what the 500 events add. Last run on a production build from a laptop (about 115 ms per round trip to Singapore): baseline 2.3 s, 500-event render 3.6 s, so the 500 events add 1.3 s (passes); HTML 976 kB after trimming client props. Co-located, on the production deployment in Vercel sin1 next to Neon Singapore, `GET /api/cron/perf-probe` (cron-signed, env-gated; run with `vercel crons run /api/cron/perf-probe`, read with `scripts/perf-probe-report.ts`) loads the same 508-item ledger through the real page: DB round trip 1.6 ms, loader 67–77 ms, full page median 1.14–1.21 s against the 2 s budget — PASS on both runs (2 Nov 2026). Enabling postgres.js prepared statements (supported by Neon's pooler) cut an 8-query transaction from 1.45 s to 0.41 s on the same link. `tests/e2e/v05-inbound.spec.ts` adds 3 tests (email drop with V05-E2E-07, WhatsApp hold and release, WhatsApp discard/expiry/code budget); it needs the inbound test values in `.env.local` and serves the WhatsApp media from a local HTTP server: 3 passed in 2.5 minutes.
- **ABDM (J6):** unit tests `src/server/abdm/crypto.test.ts` (known-answer vectors frozen from RFC 7748 §6.1 keys with fixed nonces: shared secret, XOR, salt, IV, HKDF key and both ciphertext directions; tampered ciphertext/tag, wrong nonce on either side, wrong key and expired or malformed key material all fail), `gate.test.ts` (decryption refused unless the artefact is GRANTED, unexpired, for this patient, HI types and date range; a refusal never calls decrypt), `transport.test.ts` (sandbox request shapes and headers with a stubbed `fetch`; the in-process HIP's selection and encryption) and `src/core/fhir/fhir.test.ts` (each record type, imaging/pathology/lab classification, dates, and that stage, grade, conclusions, values and dosage never reach an event; the gate's field rules reject forbidden fields). `tests/integration/abdm.test.ts` (5 tests, live DB): refusal without the `abdm` purpose or an ABHA, approve → 5 documents / 7 structured events / FHIR evidence / Radar row, revoke → full erase, HI-type scoping and denial, a tampered push that writes nothing, and `abdm_erase()` preconditions plus the erase-at sweep. `tests/e2e/v11-abdm.spec.ts` (2 tests): register with ABHA + `abdm` consent, request from the Documents tab, neutral SMS, approve in the portal, structured events in the ledger as newly received older records, Radar recomputed, FHIR source view, revoke → erased; and a request without the `abdm` purpose is refused.
- **Offline capture (V05):** `tests/e2e/v05-offline.spec.ts`, part of `npm run test:e2e`. It needs a production build (the dev client cannot hydrate from the service-worker cache) and launches its own Chromium with a fake camera and microphone.

## Project layout

- `data/eval/`: hand-authored gold labels (`gold.json`, `gold-heldout.json`), the held-out documents (`heldout/`), OCR ground truth and the evaluation reports (`report.json`, `report-llm.json`).
- `data/abdm/`: synthetic FHIR R4 document bundles and the in-process HIP's patient index (`hip.json`).
- `docs/`: `BRIEF.md` (product summary), `PRD.md` (product spec, v1.1), `ARCHITECTURE.md` (build contract and ADRs), `AGENT-RULES.md`.
- `drizzle/`: SQL migrations, including database roles and row-level security.
- `public/`: synthetic demo documents, icons, web manifest and service worker.
- `scripts/`: migrations, base seed, evaluation, synthetic-document generator and icon generator.
- `src/app/`: Next.js App Router pages and `api/` route handlers.
- `src/core/`: pure, deterministic logic (gate, dates, identity, extraction, copy, Radar, ledger). See `src/core/README.md`.
- `src/server/`: server-only code (request wrapper, pipeline, sealing, audit, outbox, admin).
- `src/db/`: Drizzle schema.
- `src/components/` and `src/lib/`: UI components, offline capture and its encryption.
- `src/i18n/`: patient-facing strings in English, Hindi and Hinglish.
- `src/proxy.ts`: security headers and nonce CSP.
- `tests/`: integration (RLS) and E2E specs.

## Known limitations

- **SMS and WhatsApp delivery is built for Twilio but has not been run against Twilio.** Set the `TWILIO_*` variables and the outbox row is delivered after the request commits (retry once on a 5xx). With none set, which is the default and the demo, messages are only recorded (`delivery = simulated`) and the demo phone shows them. Unit tests with a stubbed `fetch` prove the exact request, status updates, retry and that no number is logged. Not proven: acceptance by Twilio's API and the carrier, India DLT sender and template registration (needed for real Indian SMS), WhatsApp template approval, and delivery receipts (`sent` means accepted by Twilio).
- **LLM runs on Gemini's free tier.** Throughput is bounded by the shared budget (8 per minute, 200 per day by default); beyond it documents use the rule-based path and say so. Free-tier terms allow Google to use prompts to improve its products, so this deployment carries synthetic data only — a pilot with real records needs a paid, India-hosted or DPA-covered model (PRD §10.4, decision D12). Anthropic and the Vercel AI Gateway remain selectable by environment.
- **Malware check is a signature check.** It detects the EICAR test signature only.
- **ABDM runs against an in-process gateway, per the PRD.** A real ABDM sandbox requires a legal entity and HIU registration (and then NHA certification), so no sandbox account exists and nothing has been sent to the ABDM gateway. `SandboxGateway` is unit-tested on request shapes with a stubbed `fetch` only; its paths and headers follow the public v3 HIU flow and are unverified against the live sandbox. Not built for the sandbox: the callback routes the gateway calls (`on-init`, `hiu/notify`, `on-fetch`) and the HIU data-push endpoint, which would also have to keep the HIU's ephemeral private key (encrypted) between the request and the push. Keys are RFC 7748 X25519 keys in X.509 SPKI form; the ABDM reference (Fidelius/BouncyCastle) uses the Weierstrass form of Curve25519, so interop with a live HIP needs a Montgomery↔Weierstrass adapter for the key encoding and shared secret (the HKDF/AES-GCM derivation is unchanged). The consent request sends the 14-digit ABHA number captured at registration as the patient id; ABDM consent requests usually address the ABHA address (`name@sbx`). Entry checksums are MD5 of the plaintext bundle (our HIP's convention, to confirm against the sandbox). The in-process consent manager keeps issued artefacts in memory only for the transfer that follows the grant. Retention is a fixed 30 days. Sealed snapshots are immutable and keep ABDM facts they sealed after the erase (the ledger then shows the documents as removed). The registration consent notice (v1) still says ABDM pull is "not switched on yet"; the flow asks the patient's approval each time, but the notice text needs a v2.
- **Email drop and WhatsApp intake have not run against Postmark or Twilio.** Tests post the documented payloads, signed or authenticated as the providers do. Not proven: real Postmark and Twilio traffic, a receiving domain (the configured one is a placeholder), and WhatsApp Business sender approval. Vercel limits a request to 4.5 MB, so one mail carries about 3.3 MB of attachments (base64); larger mails are refused by the platform. The sender address of an email is not checked with SPF or DKIM: the 80-bit alias plus a verified sender address is the control. Inline images (signature logos) count as attachments. An expired WhatsApp hold that nobody answers keeps its encrypted files until the next message or the daily cron.
- **Backups are daily.** Point-in-time restore covers 6 hours (Neon free plan); after that the encrypted daily backups (35 days, private Blob store in Mumbai) lose up to 24 hours of writes. They live in the same Vercel account as the app, a restore after losing the whole Neon project (new database, migrations, then load) is documented but not exercised, and an erased patient stays inside older backups until they expire. Reading a backup needs both `BACKUP_KEY` and `APP_MASTER_KEY`.
- **Hindi is the only regional language in the portal.** Patient-facing strings are in English, Hindi and Hinglish (Hindi in Roman script, added 6 Nov 2026 and not yet reviewed by a native reader). The registration consent notice is also in Marathi (FR-CON-01, 8 Nov 2026), machine-drafted and awaiting native-speaker review before any pilot; the portal's own consent page is not yet in Marathi. Hinglish follows the browser only when chosen; there is no browser tag that asks for it.
- **Radar rules need a recorded clinician review.** The YAML library ships unreviewed (shadow mode). In the demo organisation the seed records a review for all ten rules (until 5 Nov 2026 `RAD-IMG-PT-01` stayed in shadow to show the mechanism, which hid the PET-CT a returning patient mentioned from clinicians). The wording still needs review by the team's clinician advisor before any pilot.
- **Erasure runs after the retention period, in the database.** `erase_patient()` (SECURITY DEFINER) refuses unless the request is due, consent is withdrawn and the org matches; it then deletes 20 tables of patient data in one transaction and leaves a PII-free tombstone, the consent history and the audit trail. A daily Vercel cron runs due requests; admins can run them from `/admin/erasure`. Default retention is 10 years (configurable, minimum 3).
- **Voice is measured on synthetic speech only.** With keyterms, Sarvam `saaras:v4` got the medicine name wrong in 1 of 50 synthetic clips (2%; 36% without keyterms), and that miss was a different listed drug (Capecitabine heard as Carboplatin): see `/admin/metrics` and `data/eval/asr-report.json`. Studio-clean TTS speech is an upper bound; real voices from a consented shadow phase are needed before voice is used with real patients (FR-VOX-03). Every spoken answer is read back for confirmation and stays marked as patient-reported. Recordings are kept encrypted beside the answer and erased with the patient. Desk-station mode signs itself out, but locking the tablet to the browser is the device's job.
- **Extraction recall is below target on new documents.** On the second blind set (24 documents, 9 Nov) recall is 0.691 and precision 0.785 with rules, and Gemini adds nothing; the first held-out set was 0.709 when blind (target 0.85). Fixing what each set found lifts it (0.969 and 0.755), but those are second looks. OCR error on phone photos is 7.5% (target 5%). See the Evaluation section.
- **Data location.** The database is in Singapore. `docs/BRIEF.md` §6 prefers India-hosted inference. The LLM hosting choice is an open decision (D12 in `docs/BRIEF.md` §10).
- **No real patient data.** The pilot requires IEC approval first. DPDP obligations apply from 13 May 2027.

Built from PRD v1.1 (docs/PRD.md).

License: All rights reserved. The repository has no LICENSE file.
