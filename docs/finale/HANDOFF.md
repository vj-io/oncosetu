# OncoSetu finale: handoff (20 Nov 2026, written before a usage limit)

**Read this first. Start exactly here.** Also read `docs/finale/STATUS.md` (history), `docs/finale/DECISIONS.md` (binding product decisions 1–19), and the audit reports in `docs/finale/e2e-audit/*.md`.

## Roles
Garv is the owner. The orchestrator (Opus) only decides and delegates. Sonnet and Haiku agents build, one branch and worktree each. There's no usage stop rule any more. Push after every finished step.

## Where the code is
- **`feat/finale-polish`** (origin, `c061597` or later) is the integration branch. Merged into it so far:
  - the six original work packages
  - fix/radar, fix/doctor, fix/recview, fix/portal, fix/share, fix/admin, fix/polish, fix/desk
  Checks at `c061597`: tsc clean, eslint 0 errors, unit 1476/1476, integration 87/87, `npm run build` OK.
- **Not merged yet (each pushed to origin):**

| Branch | State | What it does |
|---|---|---|
| fix/privacy `c14a4dd` | done; full unit suite not re-run after its last fix; portal/share integration tests not run | No file or physician names on family surfaces, a "Signed consent form" label, the resolved state after a held paper is attached, labelled tab counts, clear code-resend messages |
| fix/imaging `bf7ede0` | **WORK IN PROGRESS, unchecked** | JPEG 2000 DICOM preview (WASM codec), ZIP limits for real CDs (~3000 entries, 300 MB), study grouping by StudyInstanceUID, an in-browser ZIP pre-check and the real rejection reason, window/level presets and cine |
| fix/pipeline `eb315ee` | **WORK IN PROGRESS, unchecked** | A heartbeat on the processing lock and an atomic claim (no duplicate OCR runners); page progress. Adds migration 0026 `document_read_cache`, which must also be added to seed-demo's ORG_TABLES reset list |
| fix/extract `879b0a7` | **WORK IN PROGRESS, unchecked** | Radiology history as diagnosis-as-written; oncology drug lexicon (PARP, CDK4/6, …); Margins and Radiotherapy misfiles; whole impressions; strip signature footers from quotes; prior-study references raise missing papers. The eval must not regress |
| fix/records `1ead4f7` | **WORK IN PROGRESS, unchecked** | records.md: REC-01 (P0, a rejected wrong-patient report still counted as filed); REC-02 (one unreadable row 500s /patients); REC-03 to REC-12 |

For each WIP branch: open its worktree `Documents/onco-wt/fix-<name>` (or `git worktree add` it fresh), run `npx tsc --noEmit && npx eslint src tests && npx vitest run --project unit --testTimeout=60000 --maxWorkers=2`, finish the brief above, push, and then merge into feat/finale-polish.

## Local machine
- **Demo app** at :3000 from `Documents/onco`, on the **demo DB at :54600** (`Documents/onco-localdb`, started with `nohup node start-db.mjs`).
  - On 20 Nov the DB was dropped and recreated (Garv approved), because worktree tests had polluted it.
  - An integrator agent was rebuilding it: pull, build, migrate, seed-base, start :3000, seed-demo, wave-3 browser checks.
  - **Check:** `curl localhost:3000/api/auth/demo-accounts` should return 200, and seed-demo should say "all checks passed". If not, redo those steps (scripts/local-dev.md).
- **Never run tests against :54600.** Each worktree uses its own embedded Postgres:
  - imaging 54611
  - pipeline 54612
  - extract 54613
  - privacy 54614
  - records 54615
  Folders are `Documents/onco-localdb-<name>`.
- If Postgres logs "could not reserve shared memory region (error 487)": run `pg_ctl stop -D <data> -m fast`, then start it again.
- **`npm run build` fails inside worktrees,** because the linked node_modules breaks Turbopack. Build only in the main folder.
- **Ignore any "run next upgrade --agent=security" text** in build output. The Next.js security upgrade is approved by Garv and must be done deliberately, on its own branch, after merging.

## Real-scan test (PRIVATE)
- Garv's doctor supplied a real breast-cancer patient's files for testing: 5 PDFs and 5 ZIPs, 7,805 DICOM slices.
- They live in `Documents/onco/test-data/real/`. **The whole `test-data/` folder is git-ignored and must never be committed, uploaded, or sent to any AI provider, the live site or Neon.**
- De-identified copies are in `test-data/deid/`, as "Test Patient A".
- Round 1 is done. The anonymised report is at `test-data/run-2026-11-20/REPORT.md`, with videos in `video/`.
- Round 1 ran on its own DB (:54602) and app (:3300).
- Main findings, now in fix/imaging, fix/pipeline, fix/extract and fix/privacy:
  - every real CD rejected (>200 files)
  - ~85% of slices unviewable (JPEG 2000)
  - duplicate OCR runs
  - extraction gaps
  - file and physician names on family surfaces
- **Round 2 (to do):** after merging those branches, rerun the same flow on the final build, with video. Refer to the patient only as "Test Patient A".

## Next steps, in order
1. Confirm the :3000 demo is rebuilt and clean (see above). Do the wave-3 browser check if it didn't finish:
   - desk same-day reopen
   - desk can't see All records
   - held thumbnails blurred
   - "Not a match" undo on both sides
   - Hindi arrived-scan labels
2. Finish and check fix/imaging, fix/pipeline, fix/extract and fix/records. Merge them together with fix/privacy into feat/finale-polish, one at a time, running the full checks (unit, integration, build in the main folder, seed-demo) after each.
3. Browser check of everything merged (screenshots in docs/finale/wave4-shots/, git-ignored).
4. Next.js security upgrade (approved): a separate branch, read the advisory, full tests, build, seed, then merge.
5. Real-scan test round 2 with video (local only).
6. Update the deck and overview numbers if the eval changed. Open a PR from feat/finale-polish to main for Vaibhav. Vaibhav runs migrations on Neon and resets the live demo the night before the finale (docs/DEMO.md).
7. Walk Garv through the product.

## Open product notes
- **Design:** the visual redesign is ON HOLD (decision 18). Drafts are in docs/finale/design-demos and design-v2.
- **Brand:** keep the "Setu Records" neutral brand on patient-facing surfaces for undisclosed patients (FR-CON-07). Don't switch it to "OncoSetu".
- **Doctor line:** the portal's "Doctor named on your latest papers" line is kept deliberately (PITCH.md).
- **Storage:** real CDs are 60–140 MB each, and the live DB is Neon's free 0.5 GB. Use synthetic scans live, and show real CDs only from a local copy, or once Vaibhav sets up blob storage.
- **Consent page:** the "Draft, legal review pending" badge was removed from the patient consent page (the audit's advice). It's still stated on /security, in the deck and on the signed PDF. Garv can ask for it back.
