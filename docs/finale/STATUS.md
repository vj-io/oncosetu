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
