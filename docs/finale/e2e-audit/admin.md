# E2E audit: hospital IT admin and compliance auditor

Date: 19 Nov 2026, about 23:05 to 23:25 India time. Server: http://localhost:3000. Browser: headless Chromium (Playwright) at 1366x768.
Roles played: **Farhan Sheikh (Administrator)**, then **Neha Joshi (Auditor)**, both signed in from the demo role panel on `/login`.
Scripts: `C:\Users\GARV BANSAL\Documents\onco-audit\admin\`. Screenshots: `docs/finale/e2e-audit/shots/admin/`.

**What changed in the shared demo data because of this audit**
- One emergency (break-glass) grant: Farhan Sheikh on record **OS·B7F399** (Sunita Deshmukh), 19 Nov 23:16, expires 20 Nov 03:16. Reason: "Audit test: checking that emergency access is logged. No clinical use." The demo patient's contact was sent the neutral notice. Farhan is the only administrator, so nobody can review this grant (see ADM-02). The red "1 grant not yet reviewed" banner will stay on every admin page.
- I did not save any setting, role, rule, erasure or merge. To probe the role dropdown, the deactivate, reset and rule buttons, and the Settings switches, I blocked every write request in the browser. The one role-change request that fired (Neha to Clinician) was aborted before it reached the server. Neha is still Auditor.
- I pressed "Mark reviewed" on my own grant once. The server refused it with a 409, so nothing changed.

---

## (a) First impressions

### Farhan Sheikh, hospital IT admin
After sign-in I landed straight on `/admin`. The overview is calm and well organised: five headed groups (People, Safety and activity, Quality, Data requests, Settings) with a tab bar to match. Each card has a number and one line of plain explanation. In under 10 seconds I could find "Settings": it is a top tab and its own group, and the switches are the first thing on the page. Staff, Devices, Emergency access and Settings read like an ordinary admin tool. Deactivate and Reset authenticator ask for confirmation in plain words. The page will not let me demote or deactivate the last administrator. Retention will not accept fewer than 1,095 days. The Settings switch descriptions change correctly with each switch.

The trust starts to slip at the numbers. The "Blocked and held" card said 9 while its own page added up to 11. The breakdown in brackets named only 2 of the 6 non-zero kinds. "Erasure requests" has no number at all. "How well it works" and "Settings" show the words "Targets" and "Hospital" where a number should be.

The Quality pages read like engineering pages, not an admin's. The Rules page shows rule codes (`RAD-SURG-HPE-01 · v1`), a "COPY LINT CLEAN" badge, raw `{event_date} ({source_label})` placeholders and field names like `procedure_text`. The Metrics page has "provenance coverage", "macro-F1", "PRD §16.3", `not_cleared`, `scripts/eval.ts` and "Sarvam bulbul:v3 (priya)".

The worst moment came when I tried emergency access myself. It was easy to request (I had to type the patient URL; there is no other way in). It was logged at once. But then:
- the record opened with no banner saying I was in emergency access or when it ends;
- the admin alert said "A clinician opened a record…";
- the grant can never be reviewed, because I am the only admin and the system rightly refuses self-review. The red alert is now permanent.

Changing a staff member's role is a bare dropdown that saves the moment you pick a value, with no confirmation. If the network fails, the only message is "Failed to fetch".

### Neha Joshi, compliance auditor
I also landed on `/admin`. The page is titled "Admin" and says "Five areas", but I only see two groups and three tabs (Overview, Safety and activity, Quality). That is confusing for someone who is not an admin.

What I can open: Blocked and held, Emergency access (read-only, with no review button, which is correct), the Audit log (filters, Verify chain, Export CSV), How well it works, and the Consultation study with its two CSV exports.

What I cannot open, and the refusal I get:
- Staff, Devices, Settings, Rules, Erasure, Duplicates, `/patients`, `/desk`, `/capture`, `/records`, `/measure` and `/break-glass/<id>`: a clean 403 page saying "This page is not available for your role".
- A patient URL: "Patient records are not part of your role… Go to the admin console".

I checked the raw HTML of these pages for patient names and found none. **Auditors cannot reach patient records.** That is the most important requirement, and it holds.

The audit log itself works:
- "Verify chain" reported **INTACT · 694 entries verified**.
- Filters by person, action and date work.
- Export gives the full log as `audit-2026-11-19.csv`, and an export with a filter applied keeps that filter.

As an auditor, I struggled to trace anything:
- every row's "About" column shows the same short id, `01a1f4dd`;
- the role filter says `org_admin`;
- some action names are still code-like ("Event verify", "Settings demo clock");
- the details column is raw JSON with full patient UUIDs;
- the CSV switches to UTC times and raw ids and codes, although the page says "Times are India time".

---

## (b) Findings

Severity: **P0** broken or unsafe · **P1** confusing or cluttered · **P2** polish. All screenshots are in `docs/finale/e2e-audit/shots/admin/`.

| id | sev | page / URL | what happened | screenshot | suggested change (concrete) | likely file |
|---|---|---|---|---|---|---|
| ADM-01 | P1 | `/admin` card "Blocked and held" vs `/admin/safety` | Read at the same moment: the home card said **9** "(2 wrong patient, 1 hidden instructions)", but the Safety tiles added up to **11** (2 wrong-patient, 1 hidden, 2 handwriting, 2 share refused, 2 SMS limit, 2 duplicate upload). It happened every time (4 vs 5, 8 vs 10, 9 vs 11). The home total leaves out duplicate upload, emergency access, consent withdrawn and erased, and the brackets name only 2 kinds. | `03-admin-home.png`, `F-01-home-later.png`, `F-02-safety-later.png` | Use the same total as the Safety page (one shared `total` from `loadSafetyEvents`), or label it "9 of 11 events were blocks". Put the top 3 non-zero kinds in the brackets, not a fixed pair. | `src/app/(staff)/admin/page.tsx` lines 19 and 23 |
| ADM-02 | P1 | `/admin/break-glass` (and the red alert on every admin page) | Farhan, the only administrator ("Last administrator" on Staff), cannot review his own grant. "Mark reviewed" is still shown. Pressing it gives a 409 and the toast "Another administrator reviews your own emergency access". With one admin there is no other, so the alert "1 grant not yet reviewed" can never clear. | `P-02-bg-review-own.png`, `I-02-breakglass-list.png` | Hide "Mark reviewed" on your own grant and show "Needs another administrator". In a one-admin hospital, let the **auditor** confirm a review, or name a second reviewer in Settings. Say this on the Emergency access page. | `src/components/admin/ReviewBreakGlass.tsx`, `src/app/(staff)/admin/break-glass/page.tsx`, `src/server/admin/ops.ts` (`reviewBreakGlass`) |
| ADM-03 | P1 | Admin alert, home card, `/admin/break-glass` | The grant was made by the **administrator**, but the alert says "A clinician opened a record outside the patient's consent". The home card says "times a doctor opened a record…" and the page intro says "Clinician access…". The Staff column shows the raw role `ORG_ADMIN`. | `I-01-home-after-bg.png`, `I-02-breakglass-list.png` | Use "A staff member (Administrator) opened…" built from the grant's role. Show roles with the plain labels from Staff ("Administrator"). | `src/app/(staff)/admin/layout.tsx` line 21, `src/app/(staff)/admin/page.tsx` line 31, `src/app/(staff)/admin/break-glass/page.tsx` |
| ADM-04 | P1 | `/admin/staff` role dropdown | Choosing a new role in a row's dropdown at once sends `POST /api/admin/staff/<id> {"action":"set_role"}` with no confirmation. Deactivate and Reset authenticator both ask first. One slip could make someone an Administrator. | `E-03-staff-role-change.png`, `E-05-staff-deactivate.png` | Ask before saving: "Change Neha Joshi from Auditor to Clinician? Their open sessions keep the old role until…", with Cancel and Change role. Or add a per-row "Save role" button that only shows once the value has changed. | `src/components/admin/StaffManager.tsx` line 93 |
| ADM-05 | P1 | `/admin/audit` "About" and "Who" columns | Each target and unknown actor is shown by `shortId`, the first 8 characters of a time-ordered UUIDv7. Nearly every row shows **`01a1f4dd`**, so documents, facts and patients cannot be told apart. The full id is only in a hover title. | `A-03c-audit-table.png` | Show the **last** 8 characters, or the patient record code (`OS·B7F399`) for patient targets. Add a "Show only this" link that filters by the full target id. | `src/server/admin/format.ts` (`shortId`), `src/app/(staff)/admin/audit/page.tsx` lines 61 and 63 |
| ADM-06 | P1 | `/admin/audit` filters and Details column | The "Who" filter shows `Farhan Sheikh · org_admin`. The "About" filter mixes cases and codes: `audit log`, `org settings`, `rule`, `device`, `document link`. Some actions still read like code: "Event verify", "Audit verify chain", "Settings demo clock", "Rule mark reviewed", "Request patient letter". "Details (codes only)" is raw JSON such as `{"lang":"en","patientId":"01a1f4dd-67e4-…","institutionType":null}`. | `A-03b-audit-viewport.png`, `A-03c-audit-table.png` | Pass the role through `PLAIN_LABEL` ("Administrator"). Give every target type and action a sentence-case label ("Fact checked by a person", "Whole log checked", "Demo clock moved", "Missing-papers check reviewed"). Show details as key: value pairs and replace a patientId with its record code. | `src/app/(staff)/admin/audit/page.tsx` and its action and target label map |
| ADM-07 | P1 | `/patients/<id>/overview` as admin under break-glass | Once access is granted, the full record opens: name, age, papers, onboarding. Nothing says "Emergency access, ends 03:16, your reason is logged". Ordinary actions are offered, including **SEND PRE-VISIT LINK**, which would message the patient. | `H-03-breakglass-after.png` | Show a red bar at the top of every page of the record: "Emergency access: ends 20 Nov 03:16. Everything you open is logged." For an administrator, make emergency access read-only (hide Send, Register, Upload). | `src/app/(staff)/patients/[id]/layout.tsx` |
| ADM-08 | P1 | `/admin/metrics` ("How well it works") | Full of engineering terms: "Provenance coverage", "numerator and denominator", "Event precision", "recall", "macro-F1", "failed gate", "Proxy… Ground truth", "PRD §16.3", "PRD §10.4", `not_cleared / unknown`, "linted against the administrative-wording banned list", `data/eval/heldout-blind-run.json`, "Regenerate with scripts/eval.ts", "Sarvam bulbul:v3 (priya)… saaras:v4", "keyterms", "pilot". An IT admin cannot act on it. | `C-02b-metrics-viewport.png`, `C-02c-metrics-safety.png`, `C-02-admin_metrics.png` | Keep the four top tiles and the safety-target table in plain words ("Facts with their source words: 97 of 97"). Move "Reading accuracy" and "Voice accuracy" behind a collapsed "Technical test results" section. Remove the file paths, script names and PRD section numbers from the UI. | `src/app/(staff)/admin/metrics/page.tsx`, `src/components/admin/EvalReport.tsx` |
| ADM-09 | P1 | `/admin/rules` ("Missing-papers checks") | Each card shows the internal id `RAD-SURG-HPE-01 · v1` and a "COPY LINT CLEAN" badge. TRIGGER shows code fields: "needs procedure_text, event_date". EXPECTS shows lowercase type codes ("ihc molecular report"). WINDOW reads "-3650 to 0 days". The EN and HI wording shows raw placeholders: `{event_date} ({source_label})`. The footer says "Hits while under review 0 · Production items 1". The header says "Promoting a rule". | `C-01b-rules-viewport.png`, `C-01-admin_rules.png` | Lead each card with a plain title ("Pathology report after an operation"). Show the wording with a sample date and source ("…on 12 Oct 2026 (discharge summary)"). Use "Up to 10 years before" for windows, "Wording checked" for the badge, and "Found while in review / Shown to staff" for the counts. Move the rule id to small print. | `src/app/(staff)/admin/rules/page.tsx` (line 34 badge) |
| ADM-10 | P1 | `/admin` as auditor | The page says "ADMIN · …", has the title "Admin" and says "**Five areas**…", but the auditor sees two groups and three tabs. The header pill also says "ADMIN". | `N-01-auditor-home.png` | For the auditor, use the title "Audit and oversight" and "Two areas you can review: safety and activity, and quality. You cannot open patient records or change settings." | `src/app/(staff)/admin/page.tsx` line 39 |
| ADM-11 | P2 | `/admin` cards | "Erasure requests" has no number (its value is hard-coded to `''`). "How well it works" shows the word "Targets" and "Settings" shows "Hospital" in the big-number spot. The duplicates note is fine. | `03-admin-home.png` | Show "0 waiting" or "N waiting" for erasure. For Metrics, show "4 of 7 safety targets met"; for Settings, show "4 switches on". | `src/app/(staff)/admin/page.tsx` lines 27, 32 and 33 |
| ADM-12 | P2 | Admin naming | One thing has several names: "Activity log" (tab and card) and "Audit log" (page title, "ADMIN · AUDIT"). Likewise "How well it works" and "ADMIN · METRICS", and "Consultation study", "Measurement study" and "BASELINE MEASUREMENT STUDY". The Measurement page says "Same definitions as the Metrics page", "Clinicians record each consultation under Measure", and "'Median prep' in the table", but no such table is shown. | `A-03b-audit-viewport.png`, `C-03-admin_measurement.png` | Choose one name per section and use it for the tab, card, eyebrow and title ("Activity log", "How well it works", "Consultation study"). Hide the "Median prep" note until the table exists. | `src/components/admin/groups.ts`, `src/app/(staff)/admin/audit/page.tsx` line 33, `src/app/(staff)/admin/measurement/page.tsx` lines 32 and 70 |
| ADM-13 | P2 | `/admin/erasure` | Intro: "…after a patient withdrew consent **.**" (stray space). It also says "accession code", while every other admin page says "record code", and uses "execute it here" and "retention period". | `B-03-admin_erasure.png` | "Requests recorded after a patient withdrew consent. … A daily job erases it then, or you can erase it here. Patients are shown by record code only." | `src/app/(staff)/admin/erasure/page.tsx` line 28 |
| ADM-14 | P2 | `/admin/duplicates` | "transliteration-aware name matching" and "ABHA number" are not plain words. The empty state says "when one staff member requests it below", but with no candidates there is nothing below. | `B-04-admin_duplicates.png` | "Found from the national health ID (ABHA), phone, name with date of birth, and names spelled differently in Hindi and English." In the empty state, drop "below". | `src/components/admin/DuplicatesPanel.tsx` line 95 |
| ADM-15 | P2 | `/admin/settings` | Each switch's description **matches its state** (all 4 switches and 5 questions were toggled and checked). But the AI switch says "On: … an AI service may help read documents" while the box above says "no reading service is connected… fixed rules are used", and still counts "CALLS 4 of 1,000 used today". The limit form asks for "TOKENS PER DAY". "Voice shadow mode" is an unexplained name. | `C-04b-settings-viewport.png`, `D-01-settings-toggled-ai.png` | When no service is connected, have the switch say "On, but no reading service is connected, so fixed rules are used". Rename the field to "Text allowance per day (tokens)" and the switch to "Keep voice recordings to test accuracy". | `src/components/admin/SettingsForm.tsx`, `src/app/(staff)/admin/settings/page.tsx` |
| ADM-16 | P2 | All admin action toasts | A network failure shows the raw browser text "Failed to fetch". | `E-03-staff-role-change.png` | Map fetch errors to "Could not reach the server. Nothing was changed. Try again." | `src/components/admin/client.ts` (`postJson` / `useRun`) |
| ADM-17 | P2 | `/admin/<anything wrong>` while signed in | The 404 has no staff header and offers only "GO TO SIGN-IN" and "PATIENT SIGN-IN" to a signed-in admin. Its "Setu Records" brand is deliberate (neutral brand). | `G-route-admin_nope.png` | When a staff session exists, add "Go to your home page" (`/admin`) as the first button. | `src/app/not-found.tsx` |
| ADM-18 | P2 | Grammar | "**1 entries** · page 1 of 1" in the audit log when filtered. "**1 capture devices** in use" on the home card. | (text, `s10`/`s11` logs) | Pluralise: "1 entry", "1 capture device in use". | `src/app/(staff)/admin/audit/page.tsx`, `src/app/(staff)/admin/page.tsx` line 29 |
| ADM-19 | P2 | `/admin/audit` export (CSV) | The page says "Times are India time", but the CSV has UTC (`2026-11-19T17:31:42Z`), raw `actor_id` UUIDs, raw role and action codes (`org_admin`, `auth.login`), and no names. An auditor has to cross-reference by hand. | (`audit-full.csv` in scripts folder) | Add `at_ist`, `actor_name` and `action_label` columns next to the raw ones, or add a note row: "times in UTC". | `src/app/api/admin/audit.csv/route.ts` |
| ADM-20 | P2 | `/admin/audit` date filter | From 20 Nov to 18 Nov says "No audit entries match. Widen the date range" instead of saying the dates are the wrong way round. | `N-04-auditor-bad-range.png` | Check before filtering: "'From' is after 'To'." Or swap the two dates automatically. | `src/app/(staff)/admin/audit/page.tsx` |
| ADM-21 | P2 | `/account/sessions` | The rows show only times, with no browser or device, so "one you do not recognise" is hard to spot. Times are 12-hour ("11:08 pm"), while admin pages use 24-hour ("23:16"). | `J-sessions.png` | Add "Chrome on Windows · this browser" and a coarse location or IP. Use one time format across staff pages. | `src/app/(staff)/account/sessions/page.tsx` |
| ADM-22 | P2 | `/admin/safety` | 13 tiles, mostly zero, sit before the event list. Once events grow (59 by the end of the session), the useful list is pushed below the fold. | `B-01-admin_safety.png` | Show the non-zero tiles first and fold the zero ones into "Nothing in 30 days: refused by role, consent, ID number…". | `src/app/(staff)/admin/safety/page.tsx` |
| ADM-23 | P2 | All admin pages, footer | Admin pages repeat the clinical footer "EVERY FACT SHOWN LINKS TO THE EXACT WORDS IN THE DOCUMENT", which means nothing on Staff or Settings. | `A-01-admin_staff.png` | Hide the footer, or use "Every change here is written to the activity log" on `/admin/*`. | `src/app/(staff)/layout.tsx` |
| ADM-24 | P2 | `/patients/<id>` refusal for auditor | The refusal is clear ("Patient records are not part of your role"), but it returns HTTP **200**, while `/patients` gives 403. The page also has two nested `<main>` landmarks. | `M-patient-overview.png` | Return 403 through `forbidden()` and render a single `<main>`. | `src/app/(staff)/patients/[id]/layout.tsx` |
| ADM-25 | P2 | Admin emergency access path | An admin can only start emergency access by typing a patient URL; `/patients` is 403 and no admin page links to it. Either it is meant only for clinicians, and then the admin "Request break-glass access" link should not exist, or admins need a way in. | `G-route-patients_01a1f4dd_….png` | Decide: remove the admin "Request break-glass access" link, or add "Open a record in an emergency" on Emergency access with a record-code search. | `src/app/(staff)/patients/[id]/layout.tsx`, `src/app/(staff)/admin/break-glass/page.tsx` |

**Counts:** P0 0 · P1 10 · P2 15.

Console and network: on every admin and auditor page I visited, the only console errors were the expected 403 or 404 resource errors from refusal pages, the 409 from ADM-02, and the error from the request I aborted myself. There were no page errors, no 5xx and no hydration warnings.

---

## (c) What worked well
- **Auditors cannot open patient records.** `/patients`, `/patients/<id>/*`, `/break-glass/<id>`, `/api/patients` and `/api/patients/<id>/documents` all refuse. The raw HTML of the refusal and admin pages has no patient name.
- **Refusals are clear pages, not crashes.** `/patients`, `/desk`, `/capture`, `/records`, `/measure` and the admin-only sections give a 403 "This page is not available for your role" with a way home. Admin on a patient page gets a specific explanation and a break-glass link.
- **Break-glass is logged at once and everywhere:** an audit row ("Emergency access granted" with hours=4 and patientNotified=true), the Safety tile, the home card ("1 open"), the red admin alert and the grants table with the reason. The server rightly refuses self-review.
- **The audit log is solid:** "Verify chain" reports intact (321, then 694 entries). The person, action and date filters work and stay in the URL. "Clear" appears when filters are applied. Paging works. The export downloads the whole log and keeps a filter if one is set. The auditor can verify and export.
- **The Staff page has good guardrails:** the last administrator cannot be demoted or deactivated (disabled, with "Last administrator" shown). Deactivate and Reset authenticator ask for confirmation, saying what will happen. The Add-staff form keeps "Create account" disabled until it is valid and offers "Generate" for the password.
- **Settings:** every switch and question description changed correctly when toggled ("On: …" / "Off: …"). "Save" turns on only when something changed and off again when the change is undone. Retention below 1,095 days is blocked with "Enter a whole number from 1095 to 36500".
- **The Rules page** asks for confirmation before "Return to review" and explains that nothing is deleted.
- **Account menu:** name, role and hospital, "Where you are signed in" and "Sign out". Sign out goes to `/login`, and `/admin` then redirects to login. The sessions page explains the 30-minute and 12-hour limits.
- **Navigation:** the home page has the five groups with a matching tab bar and sub-tabs, so any section is two clicks away, and Settings can be found in under 10 seconds.

---

## (d) Coverage

| Area | Admin | Auditor | Notes |
|---|---|---|---|
| `/login` role panel and sign-in | yes | yes | Panel fills email, password and TOTP; the server checks it |
| `/admin` overview (5 groups / 2 groups) | yes | yes | Counts compared with section pages at the same moment |
| Staff `/admin/staff` | yes (add dialog, empty submit, role dropdown, deactivate and reset confirmations, all with writes blocked) | 403 checked | |
| Devices `/admin/devices` | yes (empty state) | 403 checked | Another tester registered a device during the run ("1 capture devices") |
| Audit log `/admin/audit` | yes: verify, filters, page 2, page 999, CSV filtered and full | yes: verify, CSV, date filter, bad range | |
| Blocked and held `/admin/safety` | yes | yes | |
| Emergency access `/admin/break-glass` | yes: grant created, logged, self-review tried | yes (read-only, no review button) | |
| Break-glass request flow `/break-glass/<id>` and record | yes (one grant on OS·B7F399) | 403 checked | |
| Erasure `/admin/erasure` | looked only (empty) | 403 checked | No erasure approved |
| Duplicates `/admin/duplicates` | looked only (empty) | 403 checked | No merge approved |
| Rules `/admin/rules` | yes, "Return to review" confirmation opened and cancelled (write blocked) | 403 checked | |
| Metrics `/admin/metrics` | yes | yes | Export link "Request outcomes (CSV)" fetched: 200 text/csv |
| Measurement `/admin/measurement` | yes | yes | Anonymised CSV fetched: 200 text/csv |
| Settings `/admin/settings` | yes: 4 switches and 5 questions toggled and untoggled, retention validation, nothing saved | 403 checked | Demo clock not touched |
| `/patients`, `/desk`, `/capture`, `/records`, `/measure` | 403 checked | 403 checked | |
| 404 inside `/admin` | yes | yes | |
| Account menu, "Where you are signed in", sign out | menu and sessions (did not press "Sign out everywhere else"; another tester may share the admin account) | menu, sessions, sign out | |
| Plain-language scan (FHIR, consent artefact, purpose d, KPI) | none of the four exact terms found | same | Other jargon is recorded in ADM-06, 08, 09, 14 and 15 |

Not covered: approving an erasure or merge (forbidden by the brief), the demo clock, "Sign out everywhere else", creating a real staff account, revoking a device, and mobile widths.
