# Restore from an encrypted backup (PRD §10.2)

**Result: PASS** · 2026-11-02 · `npx tsx --env-file=.env.local scripts/restore-from-backup.ts --blob backups/2026/11/02/oncosetu-20261102T020328Z.bak`

A daily logical backup (encrypted, in a private Vercel Blob store, off the database) restored into a fresh Neon branch, checked, and the branch deleted. This file is rewritten by every run. The point-in-time drill is `RESTORE-DRILL.md`.

## Backup

| | |
|---|---|
| Backup id | `backups/2026/11/02/oncosetu-20261102T020328Z.bak` |
| Stored | private Blob store `oncosetu-backups` (bom1), uploaded 2026-11-02T02:03:30.000Z, 34.1 MB encrypted |
| Snapshot time | 2026-11-02T02:03:29.672Z (one REPEATABLE READ transaction over every table) |
| Content | 38 tables, 26963 rows, 62.4 MB JSONL before gzip; 2 audit chains; 10 migrations |
| Export time when taken | 48.2 s (export streamed into gzip, encryption and upload) |
| Envelope | AES-256-GCM, key `BACKUP_KEY` (id in the file header); PII columns and files inside are still APP_MASTER_KEY ciphertext |

## Restore target

| | |
|---|---|
| Neon project | `mute-salad-65632065` |
| Branch | `backup-restore-20261102-021212`, parent `2026-11-02T02:03:29.672Z` (history window 6 h) |
| Branch afterwards | deleted |

## Timings

| Step | Time |
|---|---|
| Download from Blob | 2.1 s |
| Verify file (decrypt, gunzip, hash every table) | 0.4 s |
| Branch create + compute ready | 8.2 s |
| Load (TRUNCATE + insert 26963 rows, one transaction) | 63.7 s |
| Verification on the branch | 32.9 s |
| Branch delete | 7.5 s |
| **Total** | 119.9 s |

Timings are from a laptop to Vercel Blob (Mumbai) and Neon (Singapore); download, load and the re-export are bandwidth- and round-trip-bound.

## Checks

| | Check | Detail |
|---|---|---|
| PASS | backup authenticates (AES-256-GCM tag, key id in the header) and every table matches its manifest row count and SHA-256 | key bk_0220827b6f8c578b; 38 tables, 26963 rows, snapshot 2026-11-02T02:03:29.672Z |
| PASS | restore transaction committed: every table truncated, then loaded from the backup with its append-only guards disabled only inside the transaction | 38 tables, 26963 rows; triggers disabled and re-enabled on audit_log, patients, snapshots |
| PASS | no trigger left disabled after the commit | 0 disabled |
| PASS | row count and re-export SHA-256 of every table equal the backup manifest | 38 tables, 26963 rows; every table re-exports to the same bytes |
| PASS | audit chains recompute from genesis and end at the manifest head, per organisation | 0001: 249 rows to seq 249; 0002: 2998 rows to seq 2998 |
| PASS | every snapshot hash recomputes and its Ed25519 signature verifies with the app key | 56 snapshots, 0 invalid |
| PASS | stored files and patient names decrypt with APP_MASTER_KEY; each file matches its SHA-256 | 186 names (17 erased tombstones), 333 files (31.4 MB) |
| PASS | migrations on the branch equal the backup's (hash + journal time, in order) | 10 on the branch, 10 in the backup |
| PASS | restore branch deleted (backup-restore-20261102-021212) | no longer listed |

## Notes

- Repo drizzle/ files against the branch (scripts/check-migrations.mts): 10 match; in the repo but not in this backup: 0009_abdm (newer than the backup).

## Limits

- The restore lands on a branch that already has the schema (a copy of `main`, at the backup time while that is inside the history window). Restoring after losing the whole Neon project needs a new database with `drizzle/` migrations applied up to the backup's list first (roles and grants come from `0001_rls_roles.sql`); that path is not exercised here.
- Backups are daily: up to 24 h of writes can be lost once the 6 h point-in-time window has passed.
- A backup is readable only with `BACKUP_KEY` (envelope) **and** `APP_MASTER_KEY` (PII and files inside). Losing either makes it useless.
