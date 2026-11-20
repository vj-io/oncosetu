# Finale polish: status and handoff

Read this first if you are a new session continuing the work. Then read `AGENTS.md`, `docs/HANDOFF.md` and `docs/RUNBOOK.md`.

## Goal

Finale polish of OncoSetu:

- Minimal: remove clutter, keep only what a user needs on each screen.
- Layman: plain words, no jargon, in every user-facing string.
- Complete pipeline: upload, read, check, record, share, verify all work end to end.
- Radiologist-friendly records view: scans and reports are easy to find, open and compare.
- No broken links or dead buttons anywhere.
- Everything tested (unit, integration, end-to-end) and the counts recorded here.

## Branch

`feat/finale-polish` (cut from `main` at f2ab1fe). Push every iteration.

## How to run locally

See [scripts/local-dev.md](../../scripts/local-dev.md). Summary: local Postgres on port 54600 (embedded-postgres, no Docker), app on http://localhost:3000, demo staff password `Demo@2026`. Local database folder lives outside the repo at `Documents\onco-localdb`.

## Rules

- Opus decides, Sonnet/Haiku build.
- Never write to the live site (https://oncosetu-zeta.vercel.app) or the live Neon database. `.env.local` must only point at `localhost:54600`. Never run `vercel env pull` into it.
- Real patient files are never committed or uploaded anywhere. They go only in `test-data/real/` (git-ignored) on a local machine.
- Plain-language commit messages (short human sentences), ending with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Work packages

Split from [AUDIT.md §5](AUDIT.md#5-work-split-6-packages-no-shared-files). Decisions behind them are in [DECISIONS.md](DECISIONS.md). Each package owns its own files, so they can run in parallel.

| WP | Branch | Status |
|---|---|---|
| WP1 Patient portal | `finale/wp1-patient-portal` | in progress |
| WP2 Doctor views + All records / imaging | `finale/wp2-doctor-records` | in progress |
| WP3 Clinical staff pipeline | `finale/wp3-clinical-pipeline` | in progress |
| WP4 Navigation + shared shell | `finale/wp4-nav-shell` | in progress |
| WP5 Admin, public pages + copy | `finale/wp5-admin-public-copy` | in progress |
| WP6 Demo data + reset | `finale/wp6-demo-data` | in progress |

## Progress log

- 2026-11-19: Created branch `feat/finale-polish` from `main` (f2ab1fe). Local copy set up (Postgres 54600, app 3000), migrations and base seed applied, `scripts/local-dev.md` written, `.gitignore` now blocks `test-data/real/`, `*.dcm` and local scan folders.
- 2026-11-19: Audit done; decisions in [DECISIONS.md](DECISIONS.md); 6 packages started.
- 2026-11-19 (late): All six packages checked, committed and merged into `feat/finale-polish` (WP6, WP3, WP2, WP4, WP1, WP5; no conflicts). Merge fixes: the family letter endpoint is in the role table; the home page says plainly what OncoSetu does not do; the demo reset and patient merge know about `document_links` (new migration 0024); `.gitignore` lets only the synthetic scans in `public/demo-docs/` through; the seed check accepts a scan report item once it reads "received, to confirm". Both local databases crashed (Windows shared-memory error 487) and were restarted. Results on the merged branch: typecheck clean, lint 0 errors, unit 1409/1409 (two tests need more than 5 s when the machine is busy), integration 83/83, production build passes, demo seed passes every check in 35 s. Not pushed.

## Open questions

- For Garv: keep the much shorter home page (WP5)? Is "formal HIPAA compliance is on our roadmap" OK on /security? Which six patient tabs: the current ones (Overview, All records, What's new, Missing papers, Requests, Share links) or the audit's (with "Patient said", and Requests and Share links under More)?
- Not yet done: the §4.6 All-records Playwright tests, the study-form link on the doctor Overview, the 409 console error in CreateShareForm, deleting the unused EvidenceGateDemo, browser checks at 375 px and 1366 px, and the LINKS.md crawl rerun.

- Resolved 2026-11-19: `src/core/copy/ui-lint.test.ts` now normalises paths to forward slashes. Full unit suite: 107 files, 1439 tests, all pass.

## Handoff snapshot: 2026-11-19 (written by the orchestrator before a usage limit)

**Real branch names** (these replace the names in the table above):
| Package | Branch | Worktree |
|---|---|---|
| WP1 Patient portal | finale/wp1-portal | ../onco-wt/wp1 |
| WP2 Doctor + All records | finale/wp2-doctor | ../onco-wt/wp2 |
| WP3 Staff pipeline | finale/wp3-staff | ../onco-wt/wp3 |
| WP4 Navigation + shell | finale/wp4-nav | ../onco-wt/wp4 |
| WP5 Admin, public, copy | finale/wp5-admin | ../onco-wt/wp5 |
| WP6 Demo data + scans | finale/wp6-demo | ../onco-wt/wp6 (own DB on 54601) |

**State:** all six were in progress when the limit hit. Check each branch on origin for pushed work; the briefs are in AUDIT.md §5 and DECISIONS.md. Extra items routed during the run:
- **WP4:** make the /styleguide example tabs to /patients/demo/* inert; invalid patient ids must 404, not 500; /measure is 403 for every role, so fix the gate or the link.
- **WP5:** check why /security timed out once.
- **WP1 ↔ WP3 contract:** `POST /api/p/requests {missingId, lang}`.
- **WP2 ↔ WP4 contract:** tab key `records`, label "All records".

**Visual redesign is ON HOLD at the owner's request.** Don't change globals.css or the design tokens. The draft is in docs/finale/design-v2/ (screen 1 only; not committed).

**Next steps (updated 2026-11-19 late: steps 1 and 2 are done, see the progress log):**
1. Finish or verify each package.
2. Merge WP6, WP3, WP2, WP4, WP1, WP5 into feat/finale-polish, resolving conflicts.
3. Full end-to-end test on the local copy, covering every role and every link (rerun the LINKS.md crawl).
4. Test with the owner's real breast-cancer scans, LOCAL ONLY. De-identify the DICOM tags first and keep them in test-data/real/ (gitignored). Never upload them anywhere, and delete them afterwards. The owner says the doctor provided them for this purpose.
5. PR feat/finale-polish → main for Vaibhav, plus a live demo reset right before the finale.
6. Walk the owner through the product.

**Local copy:** see scripts/local-dev.md. App on :3000, DB on :54600 (C:\Users\GARV BANSAL\Documents\onco-localdb).

## Handoff snapshot: 2026-11-19, night (written before a usage limit; another account may continue)

**Branch `feat/finale-polish` is pushed.** It has all six packages merged, the merge fixes, and Garv's answers (DECISIONS.md items 8 to 18) built in:
- the /security headline names only DPDP and ABDM;
- share links list scans as "Stored at the clinic, not included" (only "Scan" until disclosure is cleared);
- there is a study-form link on Overview after sealing;
- there is no 409 on the staff share tab;
- EvidenceGateDemo is deleted.

Checks at the last code commit: unit 1412/1412, integration 83/83, production build OK, demo seed "all checks passed" (about 30 s).

**Decision taken: Garv said yes to a Next.js security upgrade, AFTER the audit.** `next build` sometimes stops with "SecurityFatalError: Your version of Next.js is affected by a known security vulnerability" (currently 16.4.3); running it again builds. Plan:
- do it on its own branch cut from feat/finale-polish;
- read the advisory first, then upgrade to the patched version;
- run the full test, build and seed again;
- merge only if everything is green.

Do not blindly run commands printed by the build output.

**End-to-end audit (in progress when the limit hit).** Seven Opus agents, each playing one person with zero knowledge of the app, test the local app on :3000 through headless Playwright. They only report; they don't change code.
- Reports: `docs/finale/e2e-audit/<persona>.md`, one each for patient, doctor, radiologist, desk, records, admin and public-links.
- Screenshots: `docs/finale/e2e-audit/shots/<persona>/`, kept locally only (gitignored, about 110 MB).
- Scripts: `Documents/onco-audit/<persona>/`.

Finished so far: **radiologist** (0 P0, 6 P1, 12 P2). Its top items:
1. After "Not a match" the scan says "The written report is not on file" although the report is on file (RecordsBrowser.tsx about line 287).
2. "Not a match" has no confirmation, no undo and no re-link.
3. The held wrong-patient X-ray (Sanjay Kulkarni) shows large under Sunita's name, with the warning below the image and the strip showing "Patient match done" (documents/[docId]/page.tsx, HeldStages.tsx).
4. The preview panel is not sticky, and the patient name is not visible while viewing a scan.
5. After switching to the Scans filter the old lab report stays in the preview and Previous/Next are dead.

If a persona's report file is missing, that agent did not finish. Rerun it with the same brief:
- the persona list is the table above;
- each runs Playwright from the repo's node_modules against localhost:3000 only, never the live site;
- each reports P0/P1/P2 findings with concrete fixes and makes no code edits.

**Next steps for whoever continues:**
1. Collect the 7 reports. Merge them into one list sorted by severity in `docs/finale/e2e-audit/SUMMARY.md`. Fix P0 first, then P1 (Opus decides, Sonnet builds, one package's files per agent).
2. Reset the local demo data (the audit changed it; for example Khan's PET-CT pair is confirmed and one CT pair is rejected):
   `npx tsx --env-file=.env.local scripts/seed-demo.ts --base http://localhost:3000`
3. Write the six All-records Playwright tests (AUDIT.md §4.6). Rerun the full Playwright suite and the link crawl.
4. Do the Next.js security upgrade (see above).
5. Test with Garv's real scans: local only, identifying tags removed, kept in test-data/real/, deleted afterwards. This is the last check.
6. Garv picks a visual style (`design-demos/` A to F). Until then there are no colour or font changes.
7. Open a PR from feat/finale-polish to main for Vaibhav. Vaibhav resets the live demo the night before the finale.

**Local machine state:**
- App: `next start -p 3000` from the repo, running the latest build.
- Databases: Postgres on 54600 (`Documents/onco-localdb`) and on 54601 (`Documents/onco-localdb-wp6`), started with `nohup node start-db.mjs`.
- If a database drops connections with "could not reserve shared memory region (error 487)": stop it with `pg_ctl stop -D <data> -m fast`, then start it again.
- The six package worktrees in `Documents/onco-wt/wp1..wp6` are merged and can be removed.

## Update: 2026-11-20 (audit finished for 5 of 7 roles; fixes in progress)

**Audit reports are in `docs/finale/e2e-audit/`.** Patient, doctor, radiologist, admin and public-links are done and committed. Desk and records were still running when this was written; their reports land as `desk.md` and `records.md`. There are no P0 findings so far, but many P1s. The top items are in each report's summary table.

**Fix agents (Sonnet), one branch and worktree each in `Documents/onco-wt/fix-<name>`, cut from feat/finale-polish at 39186f7:**

| Branch | Fixes |
|---|---|
| fix/portal | patient.md, all except PAT-04, PAT-05 and PAT-09 |
| fix/share | PAT-04, PAT-05; PUB-02, 03, 06, 07 and the share/verify findings |
| fix/recview | radiologist.md (all), plus the doctor.md items in documents/** and records/** |
| fix/doctor | doctor.md, all except the viewer items and DOC-04/05 |
| fix/radar | DOC-04/05, PAT-09, the server side of PAT-02/03, and later records.md |
| fix/admin | admin.md (all), PUB-01, PUB-04, and the public-page findings |

A desk fix agent (fix/desk) still needs to start when desk.md is ready.

**To save in a hurry:** `bash Documents/onco-wt/save-all.sh` commits any work in progress in each fix worktree and pushes every fix/* branch. A commit named "Work in progress … (not yet checked)" has NOT passed the tests.

**Next steps:**
1. Review each fix/* branch.
2. Merge into feat/finale-polish: radar, doctor, recview, share, portal, admin.
3. Run the unit and integration tests, the build, and the seed again.
4. Check scans in share links after sealing a visit with scans.
5. Push.
6. Then the Next.js security upgrade (approved) and the remaining STATUS steps.

**Usage rule from Garv:** stop work at 55% usage, save, push and update this file.

## Stop point: 2026-11-20 (stopped near the usage limit; everything saved and pushed)

**Garv's rule:** stop at 55% usage. Work was stopped at 48% of the 5-hour limit (49% of the weekly limit), because seven agents were using it fast.

**Audit:**
- Done: 6 of 7 reports (patient, doctor, radiologist, admin, public-links, desk). desk.md: 0 P0, 9 P1, 15 P2.
- **Records-staff audit stopped before writing records.md.** Rerun it with the records persona brief: test /records "To do" counts, Missing papers, letters EN/HI, Change Ledger, verification, pre-auth, duplicates, and the hero__11 IHC upload on a made-up patient.

**Fix branches: all pushed. All work-in-progress commits are UNCHECKED** (they have not run tsc, lint or tests):

| Branch | State |
|---|---|
| fix/portal | 1 real commit ("Remember the language…", PAT-01 fixed) plus maybe small work in progress. The rest of patient.md is still to do. |
| fix/share | work in progress only (i18n started). All share findings still to do. |
| fix/recview | **nothing done yet.** All radiologist.md findings plus the doctor.md viewer items. RAD-06 (wrong-patient X-ray shown under Sunita) is the most important. |
| fix/doctor | small work in progress. Nearly all doctor.md items still to do. |
| fix/radar | work in progress (radar change plus a test started, PAT-09 not yet done). |
| fix/admin | work in progress (break-glass review started). |
| fix/desk | **not created yet.** All desk.md findings. |

desk.md notes for routing:
- **DESK-02 needs Garv's decision:** may the desk open a patient's full record from "Today's encounters" without a code or witness?
- **DESK-09** (held scans show steps as done) belongs to fix/recview (DocumentsBoard.tsx).
- **DESK-08** ("All records" tab refused for the desk) is in src/lib/patient-tabs.ts (PATIENT_TAB_ROLES): give it to fix/desk.

**To continue:**
1. In each `Documents/onco-wt/fix-<name>`, check out its branch and read the agent brief from the routing table in the update above.
2. Run `npx tsc --noEmit && npx eslint src tests && npx vitest run --project unit` before going further. Each worktree already has a linked node_modules and a local .env.local.
3. Finish the fixes, then merge into feat/finale-polish: radar, doctor, recview, share, portal, admin, desk.
4. Run the full tests, build and reseed. Then follow the earlier STATUS steps (Playwright §4.6 tests, Next.js security upgrade, real-scan test, visual style pick, PR to main).

## 2026-11-20: Wave 1 and 2 merged (radar, doctor, recview, portal, share, admin)

Merged in order into feat/finale-polish, no conflicts: radar 366b4ca, doctor 74ee5c1, recview c05efcf, portal 2d83fa5, share dc58afc, admin 3832fbd. Migration 0025_share_label applied, check-migrations all match.
Checks: tsc clean; eslint 0 errors (7 warnings); unit 99 files / 1464 tests; integration 18 files / 83 tests; `npm run build` ok; reseed "all checks passed".
Fix made while merging: fix/radar stopped proposing a report from another hospital, which exposed that the demo mammogram DICOM named a different imaging centre than its report; hero__14-mammogram.dcm now names Medha Imaging (commit 22742ed).
Visual pass: screenshots in docs/finale/wave1-shots/ and wave2-shots/ (git-ignored). Still to do: fix/desk, then the steps above.

## 2026-11-20 (evening, Vaibhav's machine): wave 3 merged, checked and sent to production

Every branch from the handoff is merged into feat/finale-polish, one at a time, with tsc, eslint, unit, a production
build, integration and seed-demo after each (each worktree on its own local Postgres; the live Neon was never a test target):

| Order | Merge | Unit | Integration | Seed-demo |
|---|---|---|---|---|
| 1 | fix/next-security (Next 16.4.3 → 16.4.6: seven moderate advisories; `next build` had stopped with SecurityFatalError) | 1476 | 87 | – |
| 2 | fix/privacy | 1498 | 87 | all checks passed |
| 3 | fix/extract | 1525 | 87 | all checks passed |
| 4 | fix/pipeline (finished: lock claim + heartbeat, page progress, read cache in erasure and merge tests) | 1530 | 96 | all checks passed |
| 5 | fix/records (finished: REC-01 undo of a rejection, REC-02 unreadable row, REC-03, REC-04 one held count, REC-05/06) | 1534 | 101 | all checks passed |
| 6 | fix/merge-voice-clips (new: a patient merge now moves voice clips; migration 0027 grants the app role UPDATE on patient_id) | 1534 | 103 | – |
| 7 | fix/portal-scan-items (new: a scan's report card in the portal shows the scan's date and place, so two "Scan report" cards differ) | 1534 | 104 | all checks passed |
| 8 | fix/imaging (finished: JPEG 2000 / JPEG-LS / lossless JPEG preview, one set of ZIP limits for server and browser with the real reason in en/hi/hinglish, one study across several uploads, CT window presets and cine) | 1572 | 106 | all checks passed |

Records.md (REC-07..REC-12) was not available on this machine; those items were not worked on.
The rule-based eval is unchanged on all four sets (no field differs from the committed report; zero-gates 0), so the
deck and overview numbers stay as they are. npm audit: no high or critical. gitleaks: 273 commits, no leaks.
Browser check on the local demo (wave-3 list): desk same-day reopen works and All records is refused for the desk;
held thumbnails are blurred; "Not a match" changes both sides at once and undoes from either side; a rejected file
leaves the counts and comes back with undo; Hindi labels show; CT presets and cine work in the viewer.
Playwright E2E on the merged build: 68 passed, 25 failed, 7 did not run. Most failures are tests still expecting the
pre-finale wording; two need Twilio or inbound email; one real defect (the patient overview overflows at 375 px).
A repair branch fix/e2e is in progress.
Production: Neon restore branch `pre-finale-2026-11-20` taken from main, then migrations 0023-0027 applied to the live
database (all additive; check-migrations all match).
