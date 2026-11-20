# E2E audit: public pages, outside doctor, link check

Auditor 7 of 7 (public). Date 19 Nov 2026. Target: http://localhost:3000 only (demo mode on). Tool: Playwright, headless Chromium, PC 1366x768 and phone 375x812 (mobile emulation). Scripts: `C:\Users\GARV BANSAL\Documents\onco-audit\public\`. Screenshots: `docs/finale/e2e-audit/shots/public/`. Crawl data: `docs/finale/e2e-audit/public-links-crawl.json`.

Data I changed: I created two staff share links as Dr. Meera Iyer (clinician). One is for Khan (list and quotes, 1 day), the other for Lakshmi Narayanan (list only, 7 days). Both use the passcode `AuditPub-2026`. I also entered one wrong passcode on each link. I signed in to the portal once as Khan. Nothing else was submitted.

## (a) First impressions

**Visitor (judge), PC.** The home page works within 10 seconds. The kicker says "Records for cancer care in India". The headline is about the papers a patient carries. The intro says it is a records index for staff, patients and families and that it "never diagnoses or advises". Three cards lead to staff, patient or family, and seal check. The longer disclaimer (no staging, no reading scans, no treatment) and the footer link sit just below the fold at 768 px. The first thing that feels wrong comes after one click. "Check a sealed record" and "Patient or family" open pages branded **Setu Records**, and so does a wrong URL. That looks like a different product. From `/security` there is no way back to the home page: the logo goes to `/login`.

**Visitor, phone.** The home page reads well and has no sideways scroll. On `/security`, the three status tables put the **Status** column off-screen with no hint to swipe. On `/login`, the demo role panel sits below an empty form.

**Outside doctor.** The share link opens on a clean passcode gate that says it "opens without an account". A wrong passcode shows "That passcode did not match. Attempts left: 4." After unlocking, the heading reads **"Document index, not a clinical summary"**. Papers are grouped by kind, "Papers not in this file" is present, and the gold seal links to `/verify/<id>`, which says "This record has not changed since it was sealed". It works at 375 px with no sideways scroll. Three things erode trust:
- The page says the records were "shared by the patient" when a clinician shared them.
- The brand changes from "Setu Records" on the gate to "OncoSetu" after unlocking (Khan).
- A second date ("issued … on 19 Nov 2026") sits next to the seal date ("As of 16 Feb 2026").

## (b) Findings

Severity: P0 = broken or unsafe, P1 = confusing or cluttered, P2 = polish.

| id | sev | page/URL | what happened | screenshot | suggested change (concrete) | likely file |
|---|---|---|---|---|---|---|
| PUB-01 | P1 | `/admin/duplicates` as **Records** (Ravi Kulkarni) | The admin sub-nav shows an **"Overview"** tab linking to `/admin`, which returns **403 "This page is not available for your role"** for Records. This is a link shown to a role that leads to a refusal. The same nav names the tab for this page "Data requests" while the page heading is "Duplicate patients". | `x-records-duplicates.png`, `x-records-admin-403.png` | In `AdminNav`, render the Overview tab only when `/admin` is open to the role (org_admin and auditor), or hide the whole sub-nav when the role has a single admin page. For Records, label the single tab "Duplicate patients". | `src/components/admin/AdminNav.tsx:20`, `src/components/admin/groups.ts` |
| PUB-02 | P1 | `/s/<id>` (share view), both links | The intro line says **"A list of records shared by the patient. Not a clinical summary."** even though both links were made by staff (the clinician's table lists them as "staff · …"). The outside doctor is told the wrong source. | `d-khan-pc-3-open-full.png`, `d-lakshmi-pc-3-open-full.png` | Choose the intro by the link's creator: "shared by the clinic" for staff, "shared by the patient" or "by the patient's family" otherwise. If the creator is unknown, use neutral wording: "A list of records shared with you." | `src/components/shares/ShareViewer.tsx:21` |
| PUB-03 | P1 | `/verify`, `/verify/<id>`, `/p/login`, 404 page, `/s/<id>` gate | Brand flips between pages. `/`, `/login` and `/security` say **OncoSetu**. `/verify`, `/p/login`, the 404 page and the share gate say **Setu Records**. The "seal id is not known" page shows "Setu Records" above the link "Go to the OncoSetu home page". Khan's share link shows "Setu Records" on the gate and "OncoSetu" after unlocking. A judge clicking from the home page cards thinks they have left the site. | `v-verify-pc.png`, `v-this-does-not-exist-pc.png`, `v-verify-paste-unknown.png`, `d-khan-pc-2-wrong.png` vs `d-khan-pc-3-open.png` | Use one public brand on pages that hold no patient context (`/verify`, `/p/login`, the 404 page, the share gate before unlocking). Either keep OncoSetu there, or add one line on the home page saying patients see the neutral name "Setu Records". On the share view, keep the gate's brand after unlocking, or explain the change. | `src/app/verify/page.tsx`, `src/app/verify/[snapshotId]/page.tsx`, `src/app/not-found.tsx`, `src/app/(patient)/p/login/page.tsx`, `src/components/shares/ShareViewer.tsx` |
| PUB-04 | P1 | `/security` at 375 px | All three tables (DPDP, ABDM, HIPAA safeguards) are 640 px wide inside a 341 px scroll box. The **Status** column ("In place", "Partly", "Planned") is fully off-screen, and the middle column is cut mid-word, with no hint to swipe. The page's main message (what is built and what is not) is invisible on a phone. | `v-security-m.png`, `v-security-m-table.png` | Below 640 px, render each row as a stacked card (What, then the Status badge, then the "What we have today" text), or move the Status badge into the first cell. | `src/app/security/page.tsx` |
| PUB-05 | P2 | `/security`, `/p/login`, 404 page | No way back to the landing page. On `/security` the logo and the only header link both go to `/login`. On `/p/login` the logo links to itself. The 404 page offers only "Go to sign-in" and "Patient sign-in". `/` is linked from `/login` and `/verify` only. | `v-security-pc.png`, `v-p_login-pc.png`, `v-this-does-not-exist-pc.png` | Point the logo to `/` on public pages (`/security`, `/p/login`, the 404 page). Add a "Home" button on the 404 page next to the two sign-in buttons. | `src/app/security/page.tsx`, `src/app/not-found.tsx`, `src/app/(patient)/p/login/page.tsx` |
| PUB-06 | P2 | `/s/<id>` (share view) | Plural errors in every group: **"1 papers"** and **"1 recorded items"**. | `d-khan-pc-3-open-full.png` | Add singular forms: `{n} paper`/`papers`, `{n} recorded item`/`items`. Do the same for hi and hinglish. | `src/components/shares/ShareViewer.tsx:24-25` |
| PUB-07 | P2 | `/s/<id>` (share view) | Two dates compete. "As of 16 Feb 2026 (sealed record)" is directly above "Signature verified — issued by OncoSetu on **19 Nov 2026**". A doctor may read 19 Nov as the record date. | `d-khan-pc-3-open.png` | Change it to "Link signed by {brand} on {date}. The record inside was sealed on {sealDate}." Or drop the issue date. | `src/i18n/shares.ts:38` |
| PUB-08 | P2 | `/s/<id>` "Document list only" (Lakshmi) | Each paper card shows its first contained item as the subtitle. The "Hospital discharge summary, 9 Apr 2026" card reads **"Laboratory report · 7 Apr 2026"**, so the paper looks like a lab report from another date. | `d-lakshmi-pc-3-open-full.png` | In list-only mode, show the paper's own source, page count or "{n} recorded items" as the subtitle, not the first item's kind and date. | `src/components/shares/ShareViewer.tsx` |
| PUB-09 | P2 | `/s/<id>` passcode gate | The passcode field is a plain text input (no `type="password"`), so the passcode stays readable on screen ("wrong-pass-1" visible in the screenshot). | `d-khan-pc-2-wrong.png` | Use `type="password"` with a "Show" toggle. Keep `autocomplete="off"`. | `src/components/shares/ShareViewer.tsx` (gate form) |
| PUB-10 | P2 | `/patients/<id>/shares` after "Create link" | The success panel still shows the form hint "At least 6 characters. Give it to the doctor separately from the link." under the created passcode. The first half is now meaningless. | `d-create-khan-after.png` | After creation, show only "Give the passcode to the doctor separately from the link." | `src/components/shares/CreateShareForm.tsx`, `src/i18n/shares.ts:76` |
| PUB-11 | P2 | `/login` at 375 px | The demo role panel ("Pick a role to fill in the form") renders below the empty email, password and code form, the patient link and the security link. A judge on a phone sees a form they cannot fill. | `v-login-m.png` | On narrow screens in demo mode, put the demo panel first, or add a "Use a demo role ↓" link at the top of the form. | `src/app/login/page.tsx` |
| PUB-12 | P2 | `/p/login` at 375 px | The demo account buttons squeeze the name and description into a narrow column, so "Rohan Deshmukh: son and main contact of Sunita (opens in Hindi)" wraps over 6 lines next to the phone number. | `v-p_login-m.png` | Below 480 px, stack the phone number under the name, or show it in a smaller line below. | `src/app/(patient)/p/login/page.tsx` |
| PUB-13 | P2 | `/styleguide/staff` (demo mode) | The staff-shell preview, captioned "Desk · Today", has live links in its header and menu: `/patients`, `/measure` and `/account/sessions`. A signed-out visitor who clicks "Patients" lands on `/login`, and `/measure` is a 403 for the Desk role it depicts. The main `/styleguide` example tabs are inert, as intended ("Example only: the tabs here are not links."). | `v-sg_styleguide_staff.png` | Pass `href={undefined}` or make the shell preview render nav items as spans, as the workspace-header example already does. | `src/app/styleguide/staff/page.tsx`, `src/components/shell/StaffShell.tsx` |

Not counted as findings, but noted:
- The share gate makes `POST /api/shares/<id>/open` → 401 on load before a passcode is entered, which logs a console error. This is expected flow, but it is console noise.
- `/verify/<unknown>` and the role refusals for Admin and Auditor on patient pages ("Patient records are not part of your role", "Administrators open a record only with break-glass access") return HTTP 200, while other role gates return 403. The wording is good and nothing is linked.

## (c) Route × role status

### From the crawl (links followed from each role's landing page)

Cells give the HTTP status after redirects, with "×n" for the number of distinct URLs of that pattern. "-" means the role was never shown a link to it. Landing pages: signed out `/`; patient Khan `/p`; Desk `/desk`; Records `/records`; Clinician `/patients`; Admin `/admin`; Auditor `/admin`. Pages visited: signed out 5, patient 9, Desk 74, Records 95, Clinician 84, Admin 23, Auditor 12.

| Route pattern | signed out | patient | desk | records | clinician | admin | auditor |
|---|---|---|---|---|---|---|---|
| `/` | 200 | - | - | - | - | 200 | - |
| `/security` | 200 | - | - | - | - | 200 | - |
| `/verify` | 200 | - | - | - | - | 200 | - |
| `/login` | 200 | - | - | - | - | 200 | - |
| `/p/login` | 200 | - | - | - | - | 200 | - |
| `/p` | - | 200 ×2 | - | - | - | - | - |
| `/p/upload` `/p/visit` `/p/requests` `/p/share` `/p/abdm` `/p/consent` `/p/access` | - | 200 | - | - | - | - | - |
| `/p/permissions` (in the Privacy menu, rendered on click) | - | 200 (manual) | - | - | - | - | - |
| `/desk` | - | - | 200 ×7 | - | - | - | - |
| `/records` | - | - | - | 200 | - | - | - |
| `/preauth` | - | - | - | 200 | - | - | - |
| `/capture` | - | - | 200 | 200 | - | - | - |
| `/measure` | - | - | - | - | 200 ×2 | - | - |
| `/account/sessions` | - | - | 200 | 200 | 200 | 200 | 200 |
| `/patients` | - | - | 200 | 200 | 200 | - | - |
| `/patients/new` | - | - | 200 | 200 | 200 | - | - |
| `/patients/:id/overview` | - | - | 200 ×6 | 200 ×6 | 200 ×6 | - | - |
| `/patients/:id/records` | - | - | 200 ×6 | 200 ×6 | 200 ×6 | - | - |
| `/patients/:id/ledger` | - | - | 200 ×6 | 200 ×6 | 200 ×6 | - | - |
| `/patients/:id/completeness` | - | - | 200 ×6 | 200 ×6 | 200 ×6 | - | - |
| `/patients/:id/requests` | - | - | 200 ×6 | 200 ×6 | 200 ×6 | - | - |
| `/patients/:id/shares` | - | - | 200 ×6 | 200 ×6 | 200 ×6 | - | - |
| `/patients/:id/card` | - | - | 200 ×6 | 200 ×6 | 200 ×6 | - | - |
| `/patients/:id/timeline` | - | - | 200 ×4 | 200 ×4 | 200 ×4 | - | - |
| `/patients/:id/documents` | - | - | - | 200 ×6 | 200 ×6 | - | - |
| `/patients/:id/documents/:id` | - | - | - | 200 ×8 | 200 ×8 | - | - |
| `/patients/:id/preauth` | - | - | - | 200 ×8 | - | - | - |
| `/print/passport/:id` | - | - | 200 ×6 | 200 ×6 | 200 ×6 | - | - |
| `/print/request/:id` | - | - | 200 ×8 | 200 ×8 | 200 ×8 | - | - |
| `/verify/:id` | - | - | 200 ×2 | 200 ×2 | 200 ×2 | - | - |
| `/admin` | - | - | - | **403 (PUB-01)** | - | 200 | 200 |
| `/admin/duplicates` | - | - | - | 200 | - | 200 | - |
| `/admin/staff` `/admin/devices` `/admin/rules` `/admin/erasure` `/admin/settings` | - | - | - | - | - | 200 | - |
| `/admin/safety` `/admin/break-glass` `/admin/metrics` `/admin/measurement` | - | - | - | - | - | 200 | 200 |
| `/admin/audit` (+ `?page=1,2`) | - | - | - | - | - | 200 ×3 | 200 ×3 |
| `/api/keys` | - | - | 200 | 200 | 200 | - | - |
| `/api/snapshots/:id` | - | - | - | 200 ×2 | 200 ×2 | - | - |
| `/api/admin/audit.csv`, `/api/measure/export.csv`, `/api/measure/requests.csv` | - | - | - | - | - | 200 | 200 |

### Direct GET probe of every route file (typed URLs, not links)

`→login` means a redirect to the sign-in page. "soft" means a 200 page that shows a role refusal.

| Route | signed out | patient | desk | records | clinician | admin | auditor |
|---|---|---|---|---|---|---|---|
| `/`, `/security`, `/verify`, `/verify/:id`, `/login`, `/print/escalation`, `/styleguide`, `/styleguide/staff`, `/styleguide/patient` | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `/p/login` | 200 | 200→/p | 200 | 200 | 200 | 200 | 200 |
| `/p`, `/p/*` (9 pages) | →/p/login | 200 | →/p/login | →/p/login | →/p/login | →/p/login | →/p/login |
| `/desk` | →login | →login | 200 | 200 | 200 | 403 | 403 |
| `/records` | →login | →login | 403 | 200 | 403 | 403 | 403 |
| `/patients`, `/patients/new`, `/capture` | →login | →login | 200 | 200 | 200 | 403 | 403 |
| `/preauth` | →login | →login | 403 | 200 | 403 | 403 | 403 |
| `/measure` | →login | →login | 403 | 403 | 200 | 403 | 403 |
| `/account/sessions` | →login | →login | 200 | 200 | 200 | 200 | 200 |
| `/patients/:id` | →login | →login | →overview | →overview | →overview | 200 soft | 200 soft |
| `/patients/:id/{overview,records,ledger,completeness,requests,shares,card,documents,timeline,preauth,statements,consent,audit}` | →login | →login | 200 | 200 | 200 | 200 soft | 200 soft |
| `/patients/:id/documents/:id` | →login | →login | 403 | 200 | 200 | 200 soft | 200 soft |
| `/break-glass/:id` | →login | →login | 403 | 403 | 200 | 200 | 403 |
| `/admin`, `/admin/safety`, `/admin/break-glass`, `/admin/audit`, `/admin/metrics` | →login | →login | 403 | 403 | 403 | 200 | 200 |
| `/admin/measurement` | →login | →login | 403 | 403 | 200 | 200 | 200 |
| `/admin/duplicates` | →login | →login | 403 | 200 | 403 | 200 | 403 |
| `/admin/{staff,devices,rules,erasure,settings}` | →login | →login | 403 | 403 | 403 | 200 | 403 |
| `/print/passport/:id` | →login | →login | 200 | 200 | 200 | 403 | 403 |
| `/print/request/:id` | →login | 404 | 200 | 200 | 200 | 200 | 404 |
| `/s/:id` (no key) | 200 "This link is incomplete" | same | same | same | same | same | same |
| `/s/<unknown>#key` | 200 "This link was not found" | | | | | | |
| `/patients/demo/overview` | →login | →login | 404 | 404 | 404 | 404 | 404 |
| `/nope-404` | 404 branded | 404 | 404 | 404 | 404 | 404 | 404 |

### Compared with the old crawl (`docs/finale/LINKS.md`, live site)

- **Fixed:** `/styleguide` no longer links to `/patients/demo/*`. Those 11 URLs returned 500 before. Typed directly, they now return a clean 404, and nothing links to them.
- **Fixed:** `/measure` was unreachable before. It is now in the Clinician menu (200) and stays 403 for every other role, none of which is shown the link.
- **Fixed:** `/s/[id]` is now reached through the real "Create link" flow. Its no-key, unknown-id, wrong-passcode and right-passcode states all work.
- **Not reproduced:** the one-off `/security` timeout from the old crawl. It returned 200 every time.
- **New:** Records sees an "Overview" tab linking to `/admin`, which returns 403 (PUB-01).
- **Changed (not broken):** the old table showed signed-out `/admin` and `/patients` as 200. That was the sign-in page after a redirect. They still redirect to `/login`.

Orphan routes: none found among real pages. `/p/permissions` is only in the patient Privacy menu, which renders on click, and I confirmed it there. `/print/escalation` is linked from request lists. `/break-glass/:id` and `/patients/:id/{statements,consent,audit}` were not reached within the crawl's per-pattern cap. They return 200 for permitted roles when typed.

## (d) What worked well

- The home page says what OncoSetu is, who it is for, and what it never does, all above the fold on a PC. There is no sideways scroll on any public page at 375 px.
- The `/security` headline is exactly "Built for India's DPDP Act 2023 and ABDM." HIPAA appears only as "We are not HIPAA compliant" and "we build to its safeguards … but we are not HIPAA compliant". The page makes no compliance claim, and its counts (13 in place, 7 partly, 8 planned) are honest.
- `/verify` handles all inputs well:
  - a valid code or a full link opens the intact gold seal ("This record has not changed since it was sealed", "Hospital signature: Genuine")
  - a well-formed unknown code shows "This seal id is not known."
  - empty, garbage or script input gives an inline format hint, without navigating
- The share flow is solid for an outside doctor:
  - opens without an account
  - a wrong passcode shows how many attempts are left
  - the heading says "Document index, not a clinical summary"
  - papers are grouped by kind, newest first
  - "Papers not in this file" appears, with a clear "not a complete history" note, and the empty state is worded well
  - the seal links to the public verify page
  - "Opening this page is recorded" is stated
  - it works at 375 px, with Print and three languages
- The disclosure-unknown share (Lakshmi, "use neutral words") shows the brand **Setu Records**. It contains no diagnosis words in English or Hindi; I checked by expanding every "What it contains" section and grepping for cancer, carcinoma, tumour, malignant, chemo, onco and metastasis.
- The staff share page explains itself well. It shows "This link shows the record as sealed on 16 Feb 2026 — 22 newer items are not included", plus a QR code, and a table of every link and who opened it. Sunita correctly gets "Nothing has been sealed yet. A clinician needs to seal this visit first."
- The 404 page is branded, calm ("Nothing on any record has changed") and its buttons work.
- The role refusal page is clear: "This page is not available for your role … Nothing has changed. Go to your home page".
- `/styleguide` example workspace tabs are inert and labelled "Example only: the tabs here are not links."
- Apart from PUB-01, the crawl found no 4xx/5xx and no error page on any link shown to any role.

## (e) Coverage

- **Visitor:** I tested `/`, `/security`, `/verify` (empty, garbage, script, unknown and valid inputs, plus valid code and full link pasted, and direct URL), `/login`, `/p/login`, a wrong URL, `/styleguide`, `/styleguide/staff` and `/styleguide/patient`, each at 1366 px and 375 px, and checked the footer and header links.
- **Outside doctor:** I created links as the clinician and opened them in a fresh, cookie-less context, testing a wrong and then the right passcode at PC and phone size, plus the verify link. I also checked no-key, unknown-id and unknown-id-with-key URLs.
- **Sunita:** blocked. Staff cannot make a link before a seal, and I did not seal anything because that would change shared data. I used **Lakshmi Narayanan** instead: same "Not yet recorded: use neutral words" disclosure, sealed today.
- **Not verified: scans shown as "Stored at the clinic, not included".** No sealed snapshot in the demo data contains a scan. Khan's five scans all post-date his 16 Feb 2026 seal (one older CT was received later), Lakshmi has none, and Sunita and Aarav are unsealed. Checking this needs a new seal for Khan, which I did not do to avoid changing shared data. Recommend one auditor who owns data changes re-checks it.
- **Link check:** GET only, sequential with a 150 ms pause, skipping sign-out links, and opening `/login` and `/p/login` last for signed-in roles. Each role started at its own landing page. Coverage limits:
  - At most 8 URLs per route pattern (Desk, Records, Clinician) or 3 (other roles). 254 same-pattern URLs (mostly per-document and per-event links) were seen but not opened.
  - Links inside menus rendered only on click were checked by hand (patient Privacy menu, staff account menu).
  - A direct GET probe covered every `page.tsx` route for all 7 roles (61 routes × 7).
- **Not done:** I did not switch off links, use up passcode attempts until a lock, or test an expired link, because the data is shared with other auditors.
