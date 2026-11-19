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

## Open questions

- Resolved 2026-11-19: `src/core/copy/ui-lint.test.ts` now normalises paths to forward slashes. Full unit suite: 107 files, 1439 tests, all pass.
