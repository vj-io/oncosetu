# Front desk audit: Asha Pawar (Desk role)

Auditor role: front desk staff, no prior knowledge of the app. Desk tablet 768x1024, PC 1366x768, plus a spot check at 375 px.
Tool: Playwright with headless Chromium against http://localhost:3000 only. Scripts are in `C:\Users\GARV BANSAL\Documents\onco-audit\desk\`. Screenshots are in `docs/finale/e2e-audit/shots/desk/`.
Made-up patients I created: **Kavya Test Desai** (OS·C8A5D5, +91 90000 41234, caregiver Rohan Test Desai +91 90000 41235) and **Aarav Test Kulkarni** (OS·0BE69F, aged 12, guardian Priya Test Kulkarni +91 90000 41236). I only viewed Sunita's and Khan's records and changed nothing on them.

## (a) First impression

Signing in was easy. The role picker filled the whole form, and I landed on "Front desk" in about 2 seconds. The page tells me what to do in one sentence: identify the person with the card, phone, MRN or name. "Register a new patient" is the first button. The lookup opens on a "Scan QR" tab that says this browser cannot scan QR codes, so my first click on the page is spent leaving a tab that does not work.

Registration is a clear 3-step wizard: Identity, then Contacts and disclosure, then Consent. The error messages are short and plain, for example "Enter a 10-digit mobile number." For a minor, the guardian is required and is fixed as the main contact. Desk staff cannot set disclosure, and the screen says why. Entering a second patient with the same name, date of birth and phone gives a helpful warning, "This person may already be registered", before a duplicate record is made. With the code from the Demo phone, I could register a patient in about 1.5 minutes, so the 2-minute target is met.

What slowed me down:
- The consent notice opens in English even when I chose Hindi or Hinglish as the patient's language.
- On the consent step, errors appear at the top of a very long page while I am at the bottom pressing "Register patient". From where I am, nothing seems to happen.
- After registering, the records card shows only once. Nothing tells me to print it before I leave the page.

Once I was inside a patient, the screens mostly matched the promise of "headlines only". I saw kinds of document and dates, and no quotes. But some things surprised me:
- I could open the full record of any patient in "Today's encounters" without sending a code or recording a witness. The Patients page says the desk must check identity first.
- The Capture page lists every patient's full name and age.

The pages I should not have (/admin, /records, /measure, /preauth) gave a clean, plain refusal (HTTP 403). No layout scrolled sideways at 768 px or 1366 px. Nothing showed a script error or a 5xx.

## (b) Findings

Severity: P0 broken/unsafe · P1 confusing/cluttered · P2 polish. Totals: **0 P0 · 9 P1 · 15 P2**.

| id | sev | page/URL | what happened | screenshot | suggested change (concrete) | likely file |
|---|---|---|---|---|---|---|
| DESK-01 | P1 | /desk card lookup | Card codes contain the letter O and the letter I (e.g. `WR75-YFAZ-6OGR-…`). Typing `60GR` (zero) instead of `6OGR` returns "No matching patient in this organisation". I misread a printed card myself (`30HO`/`3OH0`). The alphabet looks like base32 (A–Z, 2–7), so 0, 1 and 8 are never valid. | shots/desk/32-lookup-zero-vs-O.png, 22-card-print-media.png | In `canonicalToken`, map 0→O, 1→I and 8→B before matching. On a miss, say "Check letters O/0 and I/1". | src/server/registration/logic.ts (`canonicalToken`, line 45) |
| DESK-02 | P1 | /desk "Today's encounters" → Open; /patients/[id]/overview, /ledger, /documents, /requests, /consent | Desk can open the full workspace of any patient with an open encounter (tested: Sunita, OS·B7F399) by clicking "Open" or typing the URL. No code was sent and no witness was recorded. The Patients page says "Open a record through Desk lookup, which checks who the person is first", and the lookup itself says "Nothing more is shown until the person is verified". | shots/desk/61-sunita-overview.png, 62-sunita-ledger.png, 63-sunita-documents.png, 03-after-login.png | Either point "Open" to `/desk?patient=…` (the verify step), as the Patients list already does, or explain on screen that an encounter opened today counts as verified. Confirm with the owner which rule is intended. | src/app/(staff)/desk/page.tsx; access check in the patient layout |
| DESK-03 | P1 | /capture step 1 "Who are these pages for?" | Lists every patient's full name, age and status (including Sunita and Khan) with no identity check. The Patients list deliberately shows "initials only". | shots/desk/47-capture-step1.png, 48-capture-two-pages.png, 60-patients-list.png | Show only patients verified or registered in this desk session, or initials plus record code, or require a lookup first. | src/components/capture/PatientPicker.tsx |
| DESK-04 | P1 | /patients/new step 3 Consent | Preferred language was हिन्दी (Kavya) or Hinglish (Aarav), but the notice opened in EN. Kavya's consent was recorded as "(EN)" and her consent SMS code came in English. Her pre-visit SMS later came in Hindi. | shots/desk/09-consent.png, 15-kavya-overview.png ("Consent on file (EN)"), 11-demo-phone.png | Start the notice tab on the preferred language chosen in step 1. Send the consent code in that language. | src/components/registration/RegistrationWizard.tsx (consent.language default), src/components/registration/ConsentCapture.tsx |
| DESK-05 | P1 | /patients/new step 3 | Pressing "Register patient" without a code, or without ticking the witness box, puts "Enter the 6-digit code from the SMS." / "Tick the witness confirmation." at the top of the page. I am about 1,500 px further down, so on my screen nothing changes. | shots/desk/10-register-without-code.png (viewport: no error visible) | Show the error next to the code field or witness tick box and scroll/focus to it. Keep the top banner as well if wanted. | src/components/registration/RegistrationWizard.tsx |
| DESK-06 | P1 | /desk verify step (and consent step) | After 4 sends, the server returns 429. The screen then shows "Sent to the registered contact. Demo: see the Demo phone drawer." in the same place as "Too many codes for this phone (or wrong codes). Try again later…". The two messages contradict each other, and there is no wait time. | shots/desk/98-otp-resend-limit.png | Clear the "Sent" hint when a send fails. Disable "Send a new code" and show "Try again in N minutes". | src/components/registration/DeskLookup.tsx (line 227 hint), src/components/registration/ConsentCapture.tsx |
| DESK-07 | P1 | /patients/[id]/card | (1) Right after registration the card is shown once. The text never says "print now, this cannot be shown again". After any navigation it reads "The card is not shown again". (2) "Replace card (old one stops working)" and "Issue a replacement card" revoke the old card at once, with no confirm. I issued 4 replacements by clicking; the audit log shows 4 "Records card replaced". | shots/desk/12-after-register.png, 13-more-menu.png, 54-kavya-audit.png | Add a notice above the card: "Print now: for safety this card is shown only once." Ask for confirmation before revoking: "The patient's current card will stop working. Replace?" | src/components/registration/QrCard.tsx |
| DESK-08 | P1 | patient tab bar "All records" | The tab is in the desk's main tab bar with a count, but opening it gives "This page is for clinicians and records staff". | shots/desk/16-kavya-records.png | Add `records: ['records','clinician']` to `PATIENT_TAB_ROLES` so `tabsFor('desk')` hides it. | src/lib/patient-tabs.ts |
| DESK-09 | P1 | /patients/[id]/documents (held scan files) | A scan held for "IDENTITY MISMATCH" shows Patient match, Facts and Quote check as done, then "CHECKLIST · HELD FOR A PERSON then" (with nothing after "then"). Held reports show "PATIENT MATCH · HELD FOR A PERSON" instead. It reads as though the scan passed the patient check. | shots/desk/57-scan-held-mismatch.png | For a held scan, stop the progress at "Patient match · held for a person", as for reports. Remove the empty "then". | src/components/documents/DocumentsBoard.tsx |
| DESK-10 | P2 | /capture | Two amber warnings: "Install this app to protect unsynced captures" and "This browser has not promised to keep this storage". Desk staff cannot act on either. | shots/desk/44-capture-after-pin.png | Keep one plain line, for example "Keep this page open until the queue shows 0." Move the storage detail to the admin device page. | src/components/capture/CaptureApp.tsx (line 223) |
| DESK-11 | P2 | /patients/new step 3 | Internal IDs on screen: "For people without a phone (FR-CON-06)" and "NOTICE · CONSENT-NOTICE.V2". | shots/desk/09-consent.png | Drop "(FR-CON-06)". Show "Notice version 2" or hide it. | src/components/registration/ConsentCapture.tsx (line 162) |
| DESK-12 | P2 | /login, consent notice, card, SMS | The app is "OncoSetu", but the consent notice, card and SMS say "Setu Records". The staff sign-in page header says "PATIENT PORTAL". The card page explains the different brand, but the consent step does not. | shots/desk/01-login.png, 09-consent.png | Explain once on the consent step: "Patients see the name Setu Records". Change the staff login header to "Staff sign-in". | src/i18n/consent.ts, src/app/login/page.tsx (line 85) |
| DESK-13 | P2 | /patients/[id]/ledger | Each line has a "Show quote" link. For the desk it opens "Headline view: verification is done by records staff and clinicians" and no quote. | shots/desk/72-desk-show-quote.png | For the desk role, label it "Details" or hide it. | src/components/ledger/LedgerItem.tsx (line 95) |
| DESK-14 | P2 | More → Who opened this record | Raw event names "Upload chunked start" and "Upload chunked finish" appear around each "Document added". | shots/desk/54-kavya-audit.png | Map `upload.chunked_*` to "Upload started/finished", or fold them into "Document added". | audit label map; events from src/server/uploads/finish.ts, src/app/api/patients/[id]/uploads/route.ts |
| DESK-15 | P2 | any unknown URL while signed in (e.g. /admin/users) | The 404 page is branded "Setu Records" and offers only "Go to sign-in" and "Patient sign-in". There is no way back to the Front desk while signed in. | shots/desk/80-forbidden_nonexistent-page.png | If staff are signed in, show "Go to your home page" (as on the 403 page). | src/app/not-found.tsx |
| DESK-16 | P2 | /desk lookup result | The match is drawn twice: a summary row inside the search box and a full "Verification required" card below it. | shots/desk/30-lookup-fresh-card.png | Keep one: the card below. | src/components/registration/DeskLookup.tsx |
| DESK-17 | P2 | /capture queue | After "Save 2 pages to queue", the item shows "SYNCING" and then disappears. Nothing says it reached Kavya's record. | shots/desk/49-capture-saved.png, 50-capture-synced.png | Show a "Sent: 2 pages to Kavya Test Desai, 11:18 pm" line for a few minutes, with a link to Documents. | src/components/capture/CaptureApp.tsx |
| DESK-18 | P2 | More → Consent & access | Shows "TEAM CASE DISCUSSION: NO", a purpose that is not among the 5 on the registration notice. Also uses jargon: "ABDM PULL", "read by the rule library only", "Checked on every use, never cached". | shots/desk/53-kavya-consent.png | Use the same 5 purpose names as the notice. Write "Fetch records through ABDM" and "Read by staff, not AI". | src/components/registration/ConsentAccess.tsx |
| DESK-19 | P2 | /desk | The lookup opens on the "Scan QR" tab, which says the browser cannot scan. | shots/desk/03-after-login.png | When the camera is unavailable, open on the code field with a label like "Card code", or on Phone. | src/components/registration/DeskLookup.tsx |
| DESK-20 | P2 | header, lookup, card | The same identifier has two names: "RECORD CODE OS·C8A5D5" in the header and "ACC. OS·C8A5D5" on the lookup and card. | shots/desk/12-after-register.png, 30-lookup-fresh-card.png | Use one name ("Record code") everywhere. | src/components/registration/DeskLookup.tsx, QrCard.tsx |
| DESK-21 | P2 | header (768 px) | The account control has no button role or label (aria snapshot: `group: Your menu Asha Pawar Desk`). The header also contains a link with no text. | shots/desk/85-account-menu.png | Make the trigger a `<button aria-label="Account menu">` and label or remove the empty link. | src/components/shell (header) |
| DESK-22 | P2 | /patients/[id]/documents (held files) | On Kavya's record, the desk sees another person's name and details, e.g. "header name: Sunita Deshmukh, F, 51 Y" and "Sanjay Kulkarni, M, 63 Y". | shots/desk/57-scan-held-mismatch.png | For the desk, say "Name on the file does not match this patient" without showing the other name. | src/components/documents/DocumentsBoard.tsx (line 312) |
| DESK-23 | P2 | /patients/new step 1 (768 px) | The legend "1 · IDENTITY" sits on the fieldset border. The MRN field is about 20 px lower than the Mobile field beside it. | shots/desk/04-register.png | Put the legend above the frame (or remove the frame). Align the two columns at the top. | src/components/registration/RegistrationWizard.tsx |
| DESK-24 | P2 | /requests, /completeness, /shares, /ledger | Each page has an intro paragraph and then a "What this shows." paragraph that repeats it. Requests also says "The 72-hour period is the regulation's reference, never a promise." | shots/desk/19-kavya-requests.png, 73-sunita-requests.png | Keep one short intro per page and drop the regulation sentence for the desk. | the tab pages under src/app/(staff)/patients/[id]/ |

## (c) What worked well

- **Sign-in** with the role picker took about 2 s. Sign out returns to /login, and Back does not reopen /desk. "Where you are signed in" lists sessions plainly.
- **Registration wizard** is quick and plain. I measured about 10 s with a script and estimate about 1.5 minutes by hand, including reading the code from the Demo phone.
  - The minor rules work: guardian required, main contact fixed to the guardian, "MINOR" badge.
  - Disclosure is locked for the desk, with the reason given.
  - The duplicate check ("This person may already be registered", strong match on name+DOB and name+phone) is very good.
- **In-person witnessed consent** works both at registration and at lookup. The tick-box wording is clear, and there is a printable notice in English and Hindi.
- **The OTP path** works: a wrong code says "That code is not valid or has expired." and the right code opens the record.
- **The records card** prints cleanly: print media shows only the card, in English and Hindi. A revoked card gives a clear "This card has been revoked…" message. The card neutral-branding note is good.
- **Capture:**
  - The device PIN setup and its errors are plain ("The PIN is exactly 6 digits.", "Wrong PIN.").
  - Pages can be reordered, retaken, deleted, or cut to the page.
  - Two photos synced in about 10 s.
- **The documents upload** accepted .dcm, .pdf and .docx.
  - All 4 wrong-patient or unclear files were **held for a person** ("IDENTITY MISMATCH", "IDENTITY INSUFFICIENT"), and nothing was filed: "0 filed · 6 held".
  - Scans are labelled "Imaging file: stored, not read".
- **Headlines only:** on What's new the desk sees document kinds and dates, with the banner "Headline list only. Quotes and checking are for records staff and clinicians." I found no quotes, diagnoses, stages or values anywhere in the desk view.
- **The pre-visit link** sent in one click and arrived in the patient's preferred language (Hindi).
- **Refusals:** /admin, /records, /measure, /preauth and the in-workspace "All records" all give a plain refusal, "This page is not available for your role… Nothing has changed.", with HTTP 403 and no crash.
- **No sideways scroll** on 23 pages checked: 10 patient tabs at 768, 6 pages at 1366, 3 at 375, plus desk, register and capture at 768. **No page errors and no 5xx.** The only 4xx responses were expected ones: 401 for a wrong OTP, 403 for refused pages, 404 for unknown URLs, and 429 for the OTP rate limit.

## (d) Coverage

| Area | Done |
|---|---|
| Sign in via the role picker, sign out, Back after sign-out, sessions page | yes |
| Front desk: all 4 lookup modes (card code, phone, MRN, name); revoked card; 0/O typo; no match | yes |
| Register an adult with OTP consent, caregiver, Hindi preference; validation errors on every step | yes (Kavya Test Desai) |
| Register a minor, no own phone, guardian as main contact, Hinglish, in-person witnessed consent, print notice | yes (Aarav Test Kulkarni) |
| Disclosure status (locked for the desk) | yes |
| Duplicate detection | yes (warning shown; I did not create the duplicate) |
| Verify an existing patient: OTP (wrong + right code), witnessed; rate limit | yes |
| Capture: PIN set/wrong/unlock, choose patient, 2-photo multi-page, reorder, save to queue, sync | yes |
| Camera capture | not tested: headless Chromium has no camera. "Open camera" button seen. |
| Upload .dcm (correct and wrong patient), wrong-patient PDF, .docx; held for a decision | yes (Documents tab; Capture accepts images only) |
| Patients list | yes |
| Desk view of a patient: Overview, What's new, Missing papers, Requests, Share links, Documents, Patient said, Consent & access, Who opened, Records card | yes (Kavya, Aarav; Sunita read-only) |
| Records card display, print (print media + PDF), replace | yes |
| Pre-visit link | yes (Kavya) |
| Share links for the desk | partial: page and its wording checked; no visit is sealed for any patient, so the desk cannot create a link. Not tried on Sunita's or Khan's records, so as not to change them. |
| Account menu | yes |
| Forbidden pages /admin, /records, /measure, /preauth | yes (403 refusal page) |
| Widths 768x1024, 1366x768, 375x812; console and network errors | yes |
