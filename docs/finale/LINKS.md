# OncoSetu live demo: link and error check

Site: https://oncosetu-zeta.vercel.app. Read-only GET crawl. No forms were submitted and no data-changing buttons were clicked. Sign-ins used the app's own demo role and patient buttons.

Coverage: signed out (50 pages), patient Khan (41), staff Desk (46), Records (234), Clinician (234), Admin (59), Audit (59). Dynamic routes were reached through links from real patient ids (for example `/patients/01a1bae2-1210-70bb-9ba8-9eac2a9ea40b/*` and its document and event pages). The six `/api/` links were GET-checked. `/print` and `/verify` links were reached through discovered snapshot ids.

## Route table

Cells are the HTTP status of a GET after redirects. A 403 is the role gate for roles a page does not serve. "-" means not crawled in that pass.

| Route | Signed out | Patient (Khan) | Desk | Records | Clinician | Admin | Audit | Problems |
|---|---|---|---|---|---|---|---|---|
| / | 200 | 200 | 200 | 200 | 200 | 200 | 200 | none |
| /account/sessions | 200 | 200 | 200 | 200 | 200 | 200 | 200 | none |
| /admin | 200 | - | 403 | 403 | 403 | 200 | 200 | 403 for roles it does not serve (expected) |
| /admin/audit | 200 | - | 403 | 403 | 403 | 200 | 200 | 403 for roles it does not serve (expected) |
| /admin/break-glass | 200 | - | 403 | 403 | 403 | 200 | 200 | 403 for roles it does not serve (expected) |
| /admin/devices | 200 | - | 403 | 403 | 403 | 200 | 403 | 403 for roles it does not serve (expected) |
| /admin/duplicates | 200 | - | 403 | 200 | 403 | 200 | 403 | 403 for roles it does not serve (expected) |
| /admin/erasure | 200 | - | 403 | 403 | 403 | 200 | 403 | 403 for roles it does not serve (expected) |
| /admin/measurement | 200 | - | 403 | 403 | 200 | 200 | 200 | 403 for roles it does not serve (expected) |
| /admin/metrics | 200 | - | 403 | 403 | 403 | 200 | 200 | 403 for roles it does not serve (expected) |
| /admin/rules | 200 | - | 403 | 403 | 403 | 200 | 403 | 403 for roles it does not serve (expected) |
| /admin/safety | 200 | - | 403 | 403 | 403 | 200 | 200 | 403 for roles it does not serve (expected) |
| /admin/settings | 200 | - | 403 | 403 | 403 | 200 | 403 | 403 for roles it does not serve (expected) |
| /admin/staff | 200 | - | 403 | 403 | 403 | 200 | 403 | 403 for roles it does not serve (expected) |
| /capture | 200 | - | 200 | 200 | 200 | 403 | 403 | 403 for roles it does not serve (expected) |
| /desk | 200 | 200 | 200 | 200 | 200 | 403 | 403 | 403 for roles it does not serve (expected) |
| /login | 200 | 200 | 200 | 200 | 200 | 200 | 200 | none |
| /measure | 200 | - | 403 | 403 | 200 | 403 | 403 | 403 for roles it does not serve (expected) |
| /p | 200 | 200 | 200 | 200 | 200 | 200 | 200 | none |
| /p/abdm | 200 | 200 | - | - | - | - | - | none |
| /p/access | 200 | 200 | - | - | - | - | - | none |
| /p/consent | 200 | 200 | - | - | - | - | - | none |
| /p/login | 200 | 200 | 200 | 200 | 200 | 200 | 200 | none |
| /p/permissions | 200 | 200 | - | - | - | - | - | none |
| /p/requests | 200 | 200 | - | - | - | - | - | none |
| /p/share | 200 | 200 | - | - | - | - | - | none |
| /p/upload | 200 | 200 | - | - | - | - | - | none |
| /p/visit | 200 | 200 | - | - | - | - | - | none |
| /patients | 200 | 200 | 200 | 200 | 200 | 403 | 403 | 403 for roles it does not serve (expected) |
| /preauth | 200 | - | 403 | 200 | 403 | 403 | 403 | 403 for roles it does not serve (expected) |
| /print/escalation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | none |
| /print/passport/01a1baed-8458-7005-8a44-a77814177ca4 | - | - | - | 200 | 200 | - | - | none |
| /print/passport/01a1ce56-bae5-76f0-a4bf-7fe53a19afae | - | - | - | 200 | 200 | - | - | none |
| /records | 200 | - | 403 | 200 | 403 | 403 | 403 | 403 for roles it does not serve (expected) |
| /security | 200 | 200 | 200 | timeout | 200 | 200 | 200 | timeout once (Records) |
| /styleguide | 200 | 200 | 200 | 200 | 200 | 200 | 200 | none |
| /styleguide/patient | 200 | 200 | 200 | 200 | 200 | 200 | 200 | none |
| /styleguide/staff | 200 | 200 | 200 | 200 | 200 | 200 | 200 | none |
| /verify/01a1baed-8458-7005-8a44-a77814177ca4 | - | - | - | 200 | 200 | - | - | none |
| /verify/01a1ce56-bae5-76f0-a4bf-7fe53a19afae | - | - | - | 200 | 200 | - | - | none |

## Broken links

- `/styleguide` (linked from `/`, `/styleguide/staff`, `/styleguide/patient`) links to `/patients/demo/{overview,documents,timeline,ledger,completeness,preauth,requests,shares,statements,consent,audit}`. All 11 return 500 in every signed-in role. The page text says the tabs link to `/patients/demo/`, so this is a placeholder id, not a real patient.

No other 4xx or 5xx link targets were found. The `/api/` links returned 200: `/api/keys`, `/api/admin/audit.csv`, `/api/measure/export.csv`, `/api/measure/requests.csv`, and two `/api/snapshots/*` ids.

## Unreachable routes

- `/measure` (`src/app/(staff)/measure/page.tsx`): no crawled page and no `href` or `router.push` literal in `src/` targets it. Typed directly it returns 403 for every staff role in the demo set.
- `/s/[id]` (`src/app/s/[id]/page.tsx`): no link found in `src/` or in the crawl. Not visited, because no id was discovered.
- `/d/${id}` is referenced only in `src/core/doctor/doctor.test.ts`. There is no `src/app/d` route, so it would 404 if used. It is not on any live page.

## Routes that 500 or show an error

- `/patients/demo/*` (11 routes): 500 in every signed-in role. Caused by the `/styleguide` placeholder links above.
- `/security`: timed out once (45 s) in the Records pass and returned 200 in the other six passes. Looks transient; retest recommended.
- No "application error" or "not found" text was found on any other page.

## Notes

- 403 responses for roles a page does not serve are the expected role gate, not breakage.
- The Khan one-tap on `/p/login` fills the form and still needs a Sign in press; the crawl pressed it.
- Raw data: `C:\Users\GARVBA~1\AppData\Local\Temp\claude\7e662a80b9fe463b\2b51c8a9-f742-4754-ae1c-d17637aa74f1\scratchpad\crawl_results.json` and `C:\Users\GARVBA~1\AppData\Local\Temp\claude\7e662a80b9fe463b\2b51c8a9-f742-4754-ae1c-d17637aa74f1\scratchpad\audit_results.json`.
