# OncoSetu runbook

Operational procedures for the people who run the deployment: backups and restore, keys, and breach response. Facts here come from the code and from the Neon project as of the latest drill (`docs/releases/v1.0/RESTORE-DRILL.md`). This is an academic and hackathon prototype on synthetic data; the pilot needs the gaps listed at the end closed first.

## 1. Backup model

| | |
|---|---|
| Database | Neon Postgres (project `mute-salad-65632065`, organisation `org-shiny-star-64825025`, region `aws-ap-southeast-1` Singapore), branch `main` |
| Mechanism | Neon keeps the write-ahead log, so any moment inside the **history window** can be restored (point-in-time restore, PITR). There is no separate dump or second copy. |
| Window | `history_retention_seconds` of the project: **21600 s (6 hours)** at the time of the last drill (free plan). Read it with `neonctl projects get mute-salad-65632065 -o json`. A longer window needs a paid plan. Anything older than the window cannot be restored. |
| What is in a restore | Everything in the database: patients, events and evidence, documents (original files as encrypted `bytea`), audit log, snapshots with their signatures, shares, sessions. |
| What is not | Environment secrets (`APP_MASTER_KEY`, `HMAC_KEY`, `SIGNING_KEY_ED25519`, `SIGNING_KEY_ID`) and the code. Both must be kept separately (sections 3 and 4). A restore without `APP_MASTER_KEY` gives unreadable names, phone numbers and files. |
| Encryption | PII columns and original files are encrypted by the app (AES-256-GCM envelope) before they reach Neon, so a restored copy is only readable with the same `APP_MASTER_KEY`. |

### Restore, step by step

Pick the timestamp first: the last moment you trust (before the bad deploy, the bad delete, the intrusion). It must be inside the window, in UTC.

**A. Into a new branch (safe, nothing is overwritten). This is what the drill does.**

```bash
# 1. restore main as it was at <ISO time> into a new branch with its own compute
neonctl branches create --project-id mute-salad-65632065 --name restore-<date> --parent 2026-11-02T09:30:00Z
# 2. connection strings (owner). Role and database are the ones in DATABASE_URL_UNPOOLED (neondb_owner, neondb)
neonctl connection-string restore-<date> --project-id mute-salad-65632065 --role-name neondb_owner --database-name neondb
neonctl connection-string restore-<date> --project-id mute-salad-65632065 --role-name neondb_owner --database-name neondb --pooled
```

The app role `oncosetu_app` exists on the branch with the same password as on `main`. Its URL is `DATABASE_URL_APP` with the host replaced by the branch's pooled host (`-pooler` in the name).

Check it before anyone uses it: sign in as an admin against the branch, open Admin → Audit and run the chain check, open `/verify/<snapshot id>` for a sealed snapshot. The drill (section 2) automates exactly these checks against a throwaway branch, so run it first if time allows.

To go live on the restored data, set `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `DATABASE_URL_APP` on the Vercel project (Production) to the branch and redeploy. Keep `main` until the incident is closed.

**B. In place (the connection strings stay the same).**

```bash
neonctl branches restore main ^self@2026-11-02T09:30:00Z --project-id mute-salad-65632065 --preserve-under-name main_before_restore_<date>
```

`main` goes back to that moment and its previous state is kept under the preserve name. Use this when you cannot change environment variables quickly. **This path has not been exercised by the drill**; try it on a throwaway branch first (`neonctl branches restore <branch> ^self@<time>`).

After either path: restart or redeploy so no pooled connection holds old state, then tell the hospital what range of time was lost (everything written after the restore point).

## 2. The restore drill

```bash
npx tsx --env-file=.env.local scripts/restore-drill.ts            # production build in $TMPDIR/oncosetu-restore-drill-build
npx tsx --env-file=.env.local scripts/restore-drill.ts --build-dir /path/to/build-copy
```

Needs `neonctl` logged in to the project, `.env.local` with the three database URLs and the keys, and Chromium for Playwright. It takes about 3 to 5 minutes from a laptop.

What it does: takes a restore point and a reference from `main`, restores into a fresh branch, checks migrations, RLS, row counts, audit chains, snapshot hashes and signatures, decrypts the stored files, starts the app on the branch from a production build of a copy of the repo and drives it with Playwright (clinician sign-in, patient ledger, public `/verify` page), then **deletes the branch** (also on failure or Ctrl-C). It never writes to `main`. It writes `docs/releases/v1.0/RESTORE-DRILL.md` and exits non-zero on any failed check.

Run it once per release (PRD §10.2: restore drill documented per version from v0.6), and after any change to the database layout, the keys or the Neon plan. Run it when nothing else writes to `main`: the reference needs about 10 s of quiet and the script retries a few times. If a run is killed hard (SIGKILL) a branch named `restore-drill-…` may be left; delete it with `neonctl branches delete <name> --project-id mute-salad-65632065` (the free plan allows 10 branches).

A FAIL means the restored copy cannot be trusted as-is. Read the failed row in the report; do not delete the evidence until someone has looked at it.

## 3. `SIGNING_KEY_ED25519` and key rotation

Sealed snapshots are signed with Ed25519. Each snapshot stores the `key_id` it was signed with, and `/api/keys` publishes the public key by id. `SIGNING_KEY_ED25519` is the base64 of a PKCS#8 PEM private key; `SIGNING_KEY_ID` names it (for example `k-2026-11`).

**Old key ids must stay verifiable**: a snapshot sealed years ago is still shown to patients and receiving hospitals, and a snapshot that fails verification is displayed as "seal broken".

**Current limitation, read before rotating.** `verifyEd25519` in `src/server/crypto.ts` accepts only the active key id and returns false for any other (the comment there: "one active key; add retired public keys here when SIGNING_KEY_ID rotates", E-PAS-04), and `publicKeys()` lists only the active key. Changing `SIGNING_KEY_ID` today would make every existing snapshot fail verification. Before the first rotation, ship a change that keeps a list of retired public keys (id and public key only) and checks the snapshot's own `key_id` against it, in both functions.

Rotation, once that exists:

1. Generate the new key: `openssl genpkey -algorithm ed25519 -out new.pem`; env value `base64 -i new.pem | tr -d '\n'`. Choose a new id (`k-YYYY-MM`). Store `new.pem` only in the secret store.
2. Add the **current** key's public half (id and `openssl pkey -in old.pem -pubout`) to the retired list. Deploy this first.
3. Set the new `SIGNING_KEY_ED25519` and `SIGNING_KEY_ID` in Vercel and redeploy.
4. Check `/api/keys` lists both ids and the public `/verify` page of an old snapshot and of a new one both say intact. Run the drill: it verifies the signature of every snapshot against the key list.
5. Keep the retired public keys for as long as any snapshot signed with them exists. The old private key is no longer needed for anything: archive it offline or destroy it.

If a private key may have leaked: treat it as a breach (section 5). Snapshots signed after the exposure can no longer be trusted as authored by the hospital; seal affected records again under a new key.

## 4. `APP_MASTER_KEY` (and `HMAC_KEY`)

- `APP_MASTER_KEY` (32 bytes, base64) wraps the per-value data keys of every encrypted column and every stored file. **If it is lost, the encrypted data is gone for good, backups included.** If it leaks, the encrypted columns and files in any copy of the database are readable.
- Generate with `openssl rand -base64 32`. Never in the repository, a chat, a ticket or a log line. Production lives in the Vercel project's encrypted environment variables; `.env.local` is for a developer machine only and is git-ignored.
- Keep two escrow copies in two separate places held by two different people (for example the hospital's custodian and the team's secret manager). Writing it down is a custody decision for the data fiduciary, not for the developers alone.
- Rotation is not built: the ciphertext format carries a version (`v1.`) but only `v1` is implemented. A rotation needs a `v2` and a job that re-wraps every data key, then the drill with both keys available. Until then, a suspected exposure is handled as a breach (section 5), not as a routine rotation.
- `HMAC_KEY` (32 bytes, base64) makes the blind indexes (phone lookups, token hashes). Same custody. Changing it breaks every lookup until all indexes are recomputed, so it also needs a migration job.
- The drill proves the keys in the environment can read the restored data: it decrypts every patient name and every stored file and compares file hashes. A passing drill after a key change is the check that the new environment is complete.

## 5. Breach response checklist

Basis: PRD §10.4 and §10.3. The hospital is the data fiduciary for its patients; OncoSetu is the processor. DPDP Act 2023 and DPDP Rules 2025: the breach obligations (intimation to the Data Protection Board, a detailed report within 72 hours, notice to affected individuals) apply from 13 May 2027, and the pilot is run to that standard from day one. **Not legal advice: confirm the wording, content and deadlines with counsel and the hospital's data protection officer before the pilot.**

Fill in the times as you go; the 72-hour clock runs from the moment the organisation becomes aware of the breach.

- [ ] **T0 recorded:** date and time (IST) we became aware: ______. Deadline for the detailed report (T0 + 72 h): ______. Incident lead: ______. Counsel: ______. Hospital contact: ______.
- [ ] **Contain.** Stop the leak without destroying evidence: revoke affected sessions (delete the rows in `sessions` for the organisation), revoke share links (`POST /api/shares/{id}/revoke`, or in Admin), revoke devices (`/api/devices/{id}/revoke`), disable staff accounts (Admin → Staff), set `DEMO_MODE` off if it was on, take the deployment offline on Vercel if the hole is not closed. Rotate any secret that may have been exposed (sections 3 and 4).
- [ ] **Preserve evidence, first.** The free-plan history window is 6 hours, so make a branch of the current state **before** any repair: `neonctl branches create --project-id mute-salad-65632065 --name incident-<date>`. Export the audit log (`/api/admin/audit.csv`) and run the chain check (Admin → Audit, `/api/admin/audit/verify`). The audit log is append-only and hash-chained; a broken chain is itself a finding. Save Vercel logs for the window (logs hold ids only, never names or phone numbers).
- [ ] **Scope.** Which organisation(s), which patients, which data (identifiers, documents, quotes, phone numbers, shared links), which time range, which access path. Use the audit log by actor, target and time, `share_views`, and `break_glass`. State what is not known yet.
- [ ] **Tell the hospital now** (the data fiduciary): what happened, when we became aware, what is known and unknown, what we have done. The hospital decides the Board filing with us; we supply the facts.
- [ ] **Intimate the Data Protection Board of India without delay**, in writing, with what is known: the nature of the breach, its extent, when and where it happened, the likely impact on the people affected. Keep a copy and the filing reference: ______.
- [ ] **Detailed report to the Board within 72 hours of T0** (or any longer period the Board allows in writing): the updated nature, extent, timing and location; the facts and reasons that led to it; the mitigation done; findings about who caused it, where known; the remedial measures to prevent a repeat; and a report of the notices given to the people affected. Filing reference: ______.
- [ ] **Notify each affected person promptly.** One message per patient or caregiver, through the contact route in the record. **Follow FR-CON-07**: unless `disclosure_status` is `cleared`, the message carries no diagnosis, stage or treatment words, no source quotes and the neutral name "Setu Records", never "OncoSetu". Say what happened, what data, what to do, who to contact. Record who was notified and when (ids only).
- [ ] **Recover.** If data integrity is in doubt, restore (section 1) to the last good moment and re-run the checks: audit chain, snapshot signatures (`/verify`), counts against the hospital's own records. Close the hole, deploy, rotate.
- [ ] **Other duties.** PRD §10.4 does not cover other reporting duties (for example CERT-In incident reporting, contract terms with the hospital or an AI vendor, ABDM obligations if integrated). Ask counsel which apply.
- [ ] **Review within a week.** Update the threat model (PRD §10.1) and the risk register, add the control or test that would have caught it, record the incident and its closure in the next release audit.

## Gaps to close before a pilot

- The restore window is 6 hours and there is no second copy. A pilot needs a longer retention window and an independent, encrypted logical backup that is itself restore-tested.
- Retired signing keys cannot be verified yet (section 3) and master-key rotation is not implemented (section 4).
- The in-place restore (`branches restore`) and the production cut-over are documented but not exercised by the drill.
- The breach checklist must be reviewed by counsel; it is an operational outline, not a legal opinion.
