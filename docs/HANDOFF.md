# OncoSetu — developer handoff

Read this first, then `README.md` (features, tests, limits), `docs/ARCHITECTURE.md` (the build contract) and
`docs/DEMO.md` (judge walkthrough). Product spec: `docs/PRD.md` (requirement ids like `FR-LED-04`). Build history,
design decision and test evidence: `docs/BUILD-REPORT.md`. Operations: `docs/RUNBOOK.md`.

## 1. Where things are

| What | Where |
|---|---|
| Live app (production) | https://oncosetu-zeta.vercel.app — demo mode, synthetic data only |
| Code | https://github.com/vj-io/oncosetu (private), branch `main` |
| Hosting | Vercel project `oncosetu` (team "vaibhav700c's projects"), functions pinned to `sin1` (Singapore) in `vercel.json` |
| Database | Neon project `mute-salad-65632065` ("oncosetu", `aws-ap-southeast-1`), branch `main`, Postgres 18 |
| Backups | Private Vercel Blob store `oncosetu-backups` (bom1 / Mumbai), `backups/YYYY/MM/DD/*.bak`, 35-day retention |
| Product name | OncoSetu (was "OncoBridge" in PRD v1.0). Patient-facing surfaces show **"Setu Records"** until disclosure is cleared |

You need: GitHub access to the repo, membership of the Vercel team, and the Neon project (or the connection strings).
Ask the owner to add you; secrets are never in the repo.

## 2. Local setup

```bash
git clone https://github.com/vj-io/oncosetu.git && cd oncosetu
npm install
vercel link --project oncosetu          # then:
vercel env pull .env.local              # pulls the Development values
npx tsx --env-file=.env.local scripts/migrate.ts      # idempotent
npx tsx --env-file=.env.local scripts/seed-base.ts    # orgs + demo staff (idempotent)
npm run dev                                           # http://localhost:3000
```

Node 22+ (developed on Node 26). **Important: local dev and production share the same Neon database.** Anything you
write locally is visible on the live site. Use the second organisation (Ganga Valley Hospital) for experiments and tests;
the demo organisation (Narmada Regional Cancer Centre) holds the judged demo data.

Sign in at `/login`: in demo mode a panel lists the demo staff (password `Demo@2026`) and fills a live TOTP code.
Patient portal: `/p/login`, the OTP arrives in the "Demo phone" drawer (simulated SMS).

### Environment variables (names only)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Neon owner role, pooled / direct (migrations, seeds, backups, admin scripts) |
| `DATABASE_URL_APP` | Non-owner app role `oncosetu_app` (no BYPASSRLS) — everything at request time uses this |
| `APP_MASTER_KEY` | AES-256-GCM envelope key for PII columns and stored files. **Losing it makes all data unreadable** |
| `HMAC_KEY` | Blind indexes (phone, token, ABHA) |
| `SIGNING_KEY_ED25519`, `SIGNING_KEY_ID`, `SIGNING_KEYS_RETIRED` | Seal and share-payload signatures; retired public keys stay verifiable (rotation: RUNBOOK §3) |
| `BACKUP_KEY` | Encrypts backups; needed together with `APP_MASTER_KEY` to read one |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (backups) |
| `CRON_SECRET` | Bearer for `/api/cron/*` (Vercel adds it to scheduled calls) |
| `DEMO_MODE` | `true` exposes demo accounts + live TOTP codes and the simulated phone. **Never on a real deployment** |
| `PUBLIC_BASE_URL` | Absolute origin (Twilio signature checks, links). Local: `http://localhost:3000` |
| `INBOUND_EMAIL_USER`, `INBOUND_EMAIL_PASSWORD`, `INBOUND_EMAIL_DOMAIN` | Postmark inbound webhook basic auth + drop domain (currently a placeholder domain) |
| `TWILIO_AUTH_TOKEN` (local only, test value) | Lets the E2E suite sign WhatsApp webhooks; not a real Twilio account |
| `PERF_PROBE_ENABLED` (production only) | Enables the cron-signed perf probe |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key (free tier) — the LLM used by this deployment |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` (optional) | Default `gemini-3.5-flash-lite`, fallback `gemini-flash-lite-latest` on 503 |
| `LLM_RPM`, `LLM_RPD`, `LLM_COOLDOWN_S` (optional) | Shared LLM budget: 8/min, 200/day, 60 s cooldown after a 429 |
| Not set (demo mode by decision) | `TWILIO_ACCOUNT_SID`/`TWILIO_FROM`/`TWILIO_WHATSAPP_FROM` (messages stay in the simulated outbox), `ABDM_CLIENT_ID`/`ABDM_CLIENT_SECRET`/`ABDM_BASE_URL` (in-process ABDM gateway), Postmark inbound (placeholder domain); `ANTHROPIC_API_KEY` / `AI_ENABLED` (optional paid LLMs) |

`vercel blob create-store --yes` and `vercel link` can rewrite `.env.local` from the Development env; check
`PUBLIC_BASE_URL` afterwards.

## 3. Architecture in five minutes

One Next.js 16 app (App Router, React 19, Tailwind v4) on Vercel; no separate API server or queue (ADR-001a in
`docs/ARCHITECTURE.md`). Postgres via drizzle-orm + postgres.js.

```
browser ──> route handlers (src/app/api/**, wrapped by route() in src/server/http.ts)  ── single policy point
            server components (requireStaff()/requirePatientSession() + withOrg())
                     │
                     ▼
            withOrg(orgId, tx => …)  → transaction with set_config('app.org_id') → RLS on every patient table
                     │
            pipeline (src/server/pipeline): file safety → text layer / tesseract OCR → classify → identity check
            → extraction (LLM if allowed, else rule-based) → EVIDENCE GATE (src/core/gate) → events → Radar recompute
```

| Folder | What lives there |
|---|---|
| `src/core/**` | Pure, deterministic logic with heavy tests: evidence gate, dates, identity, extract fallback, Radar rules + engine, ledger diff, copy lint, FHIR mapping. Public API in `src/core/README.md` |
| `src/server/**` | Server-side features: `http.ts` (route wrapper), `session.ts`, `patients.ts` (`assertPatientAccess`, consent checks), `crypto.ts`, `audit.ts`, `outbox.ts`, `pipeline/`, `ledger/`, `registration/`, `portal/`, `shares/`, `requests/`, `radar-ui/`, `admin/`, `erasure/`, `inbound/`, `sms/`, `abdm/`, `backup/`, `perf/` |
| `src/app/(staff)/**` | Staff UI (desk, patients workspace tabs, records queue, capture PWA, measure, admin) |
| `src/app/(patient)/p/**` | Patient / caregiver portal |
| `src/app/s/[id]`, `src/app/verify/[id]` | Public share viewer and seal verification |
| `src/components/ui/**` | Museum Placard design system — use it, don't restyle ad hoc (`/styleguide` shows everything) |
| `src/i18n/*.ts` | Every patient-facing string, `{ en, hi }`; linted by `src/core/copy` |
| `drizzle/` | SQL migrations (incl. RLS, roles, SECURITY DEFINER functions) + `meta/_journal.json` |
| `scripts/` | migrate, seeds, eval, restore drill, backup/restore, perf report, migration check, demo-docs generator |
| `tests/integration/`, `tests/e2e/` | Live-DB tests (app role) and Playwright specs |

## 4. Rules that keep this codebase safe (read before changing anything)

1. **Every mutation is a route handler wrapped in `route()`** with `auth`/`roles`, a zod body, and `ctx.audit(...)`
   (ids only — never names, phones, quotes or file bytes in audit rows or logs).
2. **Patient data access always goes through `assertPatientAccess(ctx, patientId)`** inside `withOrg`. Consent is
   checked on use, never cached. Desk staff also need a verified encounter from the last 12 h.
3. **POOL RULE (`src/db/index.ts`)**: inside a `withOrg` transaction never query the global `db` pool or open another
   `withOrg` — pass the `tx` through. Nesting deadlocked the server under 6 parallel uploads once. Independent lookups on
   non-RLS tables (sessions, OTP, org_settings, clock) use `sideDb`.
4. **FR-CON-07 (safety-critical)**: patient/caregiver surfaces, SMS bodies, letters, share viewer and page titles show
   no diagnosis/treatment words and no source quotes unless disclosure is `cleared`. Use `brandFor`, `patientDocLabel`
   and strings from `src/i18n/*`. `npm test` runs the copy lint over every catalogue.
5. **Nothing clinical.** No stage/grade/response/risk fields anywhere; Radar wording is about documents only. The gate
   rejects forbidden fields; don't add them to schemas.
6. **Migrations**: add a new `drizzle/00NN_*.sql`, append to `meta/_journal.json` with a `when` **greater than every
   existing entry** (drizzle silently skips older timestamps), add explicit `GRANT`s to `oncosetu_app` and
   ENABLE + FORCE RLS for patient tables (copy `0001_rls_roles.sql`). Never edit an applied migration. Apply with
   `scripts/migrate.ts`, then run `npx tsx --env-file=.env.local scripts/check-migrations.mts` (must print `match` for all).
7. **Next 16 is not the Next you know**: `proxy.ts` replaces middleware, `params`/`cookies()` are async, cache components
   are off on purpose. Read `node_modules/next/dist/docs/` before using an API. Only one `next dev` can run per folder.

## 5. Testing

```bash
npm run typecheck && npm run lint && npm test          # 1,344 unit tests (90 files; includes the eval regression guard and the RBAC table)
npm run build && npm run test:integration              # 79 live-DB tests (17 files); the log-redaction test starts `next start` from the build
npm run test:e2e                                       # 99 Playwright tests (main, webkit, clock) against BASE_URL (default :3000)
```

- E2E runs entirely in the **Ganga** org with `*@ganga.test` staff; the two clock-moving tests run alone in the `clock`
  project. For realistic timings run against a production build:
  `npx next build && PUBLIC_BASE_URL=http://localhost:3100 INBOUND_MEDIA_TEST_HOSTS=127.0.0.1 npx next start -p 3100`
  then `BASE_URL=http://localhost:3100 PUBLIC_BASE_URL=http://localhost:3100 npx playwright test`. Building in the same
  folder as a running dev server disturbs it — build in a copy (clone `node_modules` with `cp -Rc`; Turbopack refuses a
  symlinked `node_modules` outside the project root).
- Offline capture is `tests/e2e/v05-offline.spec.ts`; it needs a production build (it launches its own Chromium with a
  fake camera and microphone and a persistent profile).
- WebKit subset: `npx playwright test --project=webkit` (needs `npx playwright install webkit`).
- One spec only: `npx playwright test --project=main <file>`, then `--project=clock --no-deps <file>` for its @clock
  tests. A bare file filter also runs every project the clock project depends on.
- Extraction eval: `npx tsx --env-file=.env.local scripts/eval.ts` → `data/eval/report.json` (tuned + held-out sets, OCR CER); `--llm` → `report-llm.json` (about 60 free-tier calls). Results show on `/admin/metrics`.
- OTP sends are limited to 3 per phone per 10 min — tests use fresh random phones.

## 6. Deploy and operations

- Deploy: `vercel deploy --prod` from a clean tree (or `git archive HEAD` into a temp folder if your tree has work in
  progress). Production alias: oncosetu-zeta.vercel.app.
- Crons (`vercel.json`, daily): erasure (02:00), inbound-holds (02:15), outbox sweeper (02:30), perf-probe (02:45),
  backup (03:00), abdm-erase (03:15), llm-health (03:30), requests reminders (04:30 UTC = 10:00 IST). Trigger one now: `vercel crons run /api/cron/<name>`.
- Backups: `npx tsx --env-file=.env.local scripts/backup.ts [--list]`; restore into a throwaway Neon branch and verify:
  `scripts/restore-from-backup.ts --blob latest`. Point-in-time drill: `scripts/restore-drill.ts`. Details and the breach
  checklist: `docs/RUNBOOK.md`.
- Co-located performance check: `vercel crons run /api/cron/perf-probe`, then
  `npx tsx --env-file=.env.local scripts/perf-probe-report.ts` (last result: 1.14 s for a 508-item ledger, budget 2 s).
- Demo reset before a presentation (rebuilds the Narmada demo data through the real API, ~9 min, needs `npm run dev`):
  `npx tsx --env-file=.env.local scripts/seed-demo.ts --base http://localhost:3000`.

## 7. What is not finished — pick up here

**Kept in demo mode by decision** (code exists and is tested with stubbed responses; turn on with real accounts):

| Item | To finish |
|---|---|
| LLM extraction | **Live on Gemini's free tier** (see README "LLM extraction"). Free-tier terms let Google use prompts, so keep synthetic data only; for a pilot switch to a paid / DPA-covered model (`ANTHROPIC_API_KEY`, or raise `LLM_RPM`/`LLM_RPD` on a paid Gemini key). Health check: `vercel crons run /api/cron/llm-health`, then `scripts/llm-health-report.ts` |
| Twilio SMS / WhatsApp | Twilio account + sender, `TWILIO_*` env; for Indian SMS, DLT sender and template registration; point the WhatsApp webhook at `/api/inbound/whatsapp`. Set `WHATSAPP_INTAKE_NUMBER` so the patient's send page shows the number to forward to. Add a status-callback webhook for delivery receipts (not built) |
| Postmark email drop | Inbound server + an MX domain; set `INBOUND_EMAIL_DOMAIN` to it; webhook `https://USER:PASS@<host>/api/inbound/email` |
| ABDM sandbox | Legal entity + HIU registration; set `ABDM_*`. Still to build for the live sandbox: the gateway callback routes, the data-push endpoint (must keep the HIU private key encrypted between request and push), a key-format adapter for the reference Curve25519 encoding, ABHA *address* support, and confirming the entry checksum convention. Today the PRD-specified in-process gateway (real X25519/HKDF/AES-GCM) runs |

**Known limits worth improving**

- Extraction recall on layouts the rules have not seen is about 0.65–0.7 (target 0.85): blind recall 0.709 (held-out,
  1 Nov), 0.691 (second blind set, 9 Nov) and 0.651 with precision 0.800 (third blind set, 10 Nov,
  `data/eval/heldout3-blind-run.json`). All three sets have now been used for fixes (0.979, 0.873 and 0.714 are second
  looks), so the next honest number needs a fourth fresh set from an author who has not seen the rules, given an empty
  scratch folder of its own (`scripts/demo-docs/heldout3-docs.ts` shows the format; do not run `generate-heldout.ts`,
  which would overwrite the audited `gold-heldout.json` with older labels). Identity holds true documents for a person
  (7 of 40, 3 of 24 and 5 of 24) but attached none to the wrong patient. OCR CER on phone photos is 7.4% (target 5%).
  Gold labels need the clinician advisor's review.
  Drug-name accuracy for voice is measured on 50 synthetic clips only; real voices need the pilot (shadow mode exists). The three fact types added on 5 Nov (allergy, follow-up date, lab result
  rows) have no gold labels yet, so the eval counts them without scoring them. The `--llm` report predates them.
- Malware check is the EICAR signature behind the `MalwareScanner` interface (ADR-016); a ClamAV host is still needed.
- CI (`.github/workflows/ci.yml`) runs on every pull request: typecheck, lint and unit tests, `npm audit` (high and
  critical), a gitleaks scan of the full history and Semgrep (OWASP Top 10) all passed on PR #7 (9 Nov). The integration
  and Playwright jobs skip until a `CI_ENV_FILE` secret points at a dedicated CI Neon branch, never production; until then
  those suites run by hand on a temporary Neon branch before each merge (build report §5 and §6).
- ASVS L2 self-assessment (`docs/security/ASVS-L2-checklist.md`): 4 rows not met, all needing something outside code: a
  breached-password list or service (2.1.7), a way to email or text staff when their credentials change (2.2.3), and a
  KMS for the keys (6.4.1, 6.4.2). Patients have no list of their own sign-ins (3.3.4, partly).
- Staff sign-in: every account needs its authenticator; a real authenticator's code is accepted once (`staff.totp_last_step`).
  The seeded demo and E2E accounts use public secrets (`demoTotpSecret`) and are exempt, so tests can sign in in parallel.
  On HTTPS the cookie is `__Host-os_sid`; plain-http localhost keeps `os_sid`.
- Load test (`scripts/load-test.ts`, `data/perf/load-test.json`): at 2,000 patients every page staff use answers in
  about 3–4.5 s from a laptop to Neon Singapore, mostly round trips; the records queue shows the first 100 patients.
- Cross-organisation identity: an ABHA links one person across organisations (0019), but `person_registered_elsewhere()`
  is not shown to staff until a patient-consent link to the other organisation exists (PRD §10.3).
- Hindi is the only regional language; Hindi copy and Radar wording need review by a native speaker and the clinician
  advisor before a pilot.
- Backups: up to 24 h data loss after the 6 h PITR window; same Vercel account as the app (pilot needs an off-account
  copy); erased patients linger in backups up to 35 days.
- Name search and duplicate detection decrypt all patients of an org (marked `ponytail:` — fine to ~10k patients).
- Pilot needs IEC approval; DPDP obligations apply from 13 May 2027 (see PRD §10.4).

## 8. Gotchas we hit

- Neon pooler + postgres.js: prepared statements are ON (`DB_PREPARE=false` to disable). With them off, every
  parameterised query cost an extra round trip and `Promise.all` didn't pipeline.
- The Anthropic adapter closes every object schema for structured output — `extraction.v1` lists fields explicitly
  for that reason (`src/core/extract/schema.ts`). Don't revert to `z.record`.
- Vercel request bodies are capped at 4.5 MB; the client re-encodes photos to JPEG ≤ 2400 px before upload.
- The demo clock (`/admin/settings`, `now(orgId)`) only affects reminders and seals; sessions and erasure eligibility
  use real time by design.
- `assertPatientAccess` returns 410 for erased patients; pages must treat that as denied.
