# Restore drill (V06-E2E-02, PRD §10.2)

**Result: PASS** · 2026-11-02 · run with `npx tsx --env-file=.env.local scripts/restore-drill.ts`

Point-in-time restore of the production database into a fresh Neon branch, integrity checks on the restored copy, an app smoke run against it, then the branch is deleted. This file is rewritten by every run.

## What was restored

| | |
|---|---|
| Neon project | `mute-salad-65632065` (organisation `org-shiny-star-64825025`) |
| Source | branch `main` (default) |
| Restore point | `2026-11-02T00:25:20.360Z` (taken between two identical reads of main; attempt 1) |
| Restored into | new branch `restore-drill-20261102-002512`, parent LSN `0/6203958`, own read-write compute |
| Point-in-time window | 21600 s (6 h) of history |
| Branch afterwards | deleted |

## Timings

| Step | Time |
|---|---|
| Reference from main + restore point (two reads, 1 attempt(s)) | 3.0 s |
| Branch create (control plane) | 2.7 s |
| Compute ready (first successful query) | 1.1 s |
| Verification on the branch (migrations, RLS, counts, audit chains, snapshots, decryption) | 10.3 s |
| Production build of the repo copy | 40.1 s |
| Smoke: server start + sign-in + ledger + /verify | 11.2 s |
| Branch delete | 7.6 s |
| **Total** | 85.9 s |

Network note: timings are from a laptop to Neon Singapore (about 100 ms round trip), so the verification and smoke figures are dominated by round trips.

## Checks

| | Check | Detail |
|---|---|---|
| PASS | reference on main: every snapshot hash and signature valid before the restore | 43 snapshots, 0 invalid |
| PASS | migrations: every file in drizzle/ is applied | 8 applied, 8 in the journal, 8 .sql files; last 0007_outbox_delivery |
| PASS | RLS enabled, forced and with a policy on every patient table | 28 tables; the other 5 (organisations, org_settings, otp_challenges, sessions, staff) hold no patient data |
| PASS | app role is not a superuser and does not bypass RLS; append-only triggers exist | oncosetu_app super=false bypassrls=false; 4/4 append-only triggers |
| PASS | app role on the restored database: RLS filters rows, audit_log cannot be deleted from | no organisation set: 0 patients; Ganga set: 115 of 115; DELETE on audit_log: permission denied |
| PASS | row count of every table equals the reference | 33 tables, 7801 rows |
| PASS | audit chain head (seq + hash) per organisation equals the reference | Narmada seq 246, Ganga seq 1823 |
| PASS | audit chains recompute and end at the reference head, per organisation | Narmada: 246 rows, head seq 246; Ganga: 1823 rows, head seq 1823 |
| PASS | every snapshot hash recomputes and its Ed25519 signature verifies with the app public key, as on main | 43 snapshots, 0 invalid; key k-2026-11 (public key c6105ccaded4bf53…) |
| PASS | stored files and patient names decrypt with APP_MASTER_KEY; each file matches its recorded SHA-256 | 112 names (7 erased tombstones skipped), 239 files (24.1 MB) |
| PASS | smoke: signed in as the Ganga clinician and opened a patient ledger | HTTP 200, 1 items, seal plaque with "Verify seal" shown, 4562 ms |
| PASS | smoke: the public /verify page of snapshot S1 reports it intact (no session) | HTTP 200, "This record has not changed since it was sealed." shown, 1110 ms |
| PASS | smoke: the app wrote to the restored branch (sessions grew) | sessions 532 → 533 |
| PASS | restore branch deleted (restore-drill-20261102-002512) | no longer listed |

## Notes

- Migration file(s) 0004_resolve_snapshot differ from the text recorded when they were applied on main (edited after applying; drizzle does not re-run an applied migration). The restored database matches main, so the drill is unaffected, but a fresh database built from drizzle/ would not be identical to production.

## Reference taken from main at the restore point

Rows per table: ai_runs 0, audit_log 2069, break_glass 2, caregivers 64, consents 134, devices 0, document_files 239, document_pages 233, documents 192, encounters 115, erasure_requests 8, events 1582, evidence 1582, measurement_form_doc_types 9, measurement_forms 12, missing_records 120, org_settings 2, organisations 2, otp_challenges 107, outbox 116, patient_aliases 318, patient_merges 5, patient_statements 30, patients 119, record_requests 18, rule_states 19, sessions 532, share_links 22, share_views 33, snapshots 43, staff 10, verification_qa_reviews 0, verifications 64.

Audit chain heads: 0193a000-0000-7000-8000-000000000001 seq 246 (246 rows) hash 90223a2549e9bfb9…; 0193a000-0000-7000-8000-000000000002 seq 1823 (1823 rows) hash 397eff573bb40f1a….
Snapshots: 43, all hashes recomputed and signatures verified on main before the restore.

## Limits of this drill

- It restores to a moment seconds old, taken from the live branch. The point-in-time mechanism is the same for any moment inside the history window, but an older restore point cannot be compared with a reference taken now.
- The window is the Neon project's history retention (see above). Nothing older than that can be restored from Neon; there is no second copy.
- The smoke run uses the demo organisation Ganga's test staff. It writes a session row (and audit rows) on the restored branch only.
