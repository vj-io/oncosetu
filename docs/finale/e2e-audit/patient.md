# Patient portal audit: family member on a cheap Android phone

Auditor role: a patient's family member who has never seen the app. Device: headless Chromium at 375x812, touch, mobile. Base: http://localhost:3000 only. Date: 19 Nov 2026.
Screenshots: `docs/finale/e2e-audit/shots/patient/`. Scripts: `C:\Users\GARV BANSAL\Documents\onco-audit\patient\`.
I signed in with only the on-screen steps. I did **not** need `docs/DEMO.md`.

## (a) First impressions, as the people using it

**Rohan, Sunita's son (Hindi, diagnosis not shared with him).** The sign-in steps worked first time: number, "Send code", "Demo phone", "Show latest message". The SMS reads "आपका Setu Records कोड … है". The app opened in Hindi with "नमस्ते, Rohan". Missing papers come first, each with a black "भेजें" button and a "पत्र बनाएँ" button, so I knew in a few seconds what to do. I searched every page in Hindi, English and Hinglish, plus both letters and the SMS. I found **no cancer or diagnosis word**. The brand shows as "Setu Records", and the hospital and lab names are neutral. Some things did confuse me:
- The page says "आपकी फ़ाइल" (your file), but it is my mother's file. A banner calls her "रिकॉर्ड SD", which I did not understand.
- The visit questions ask "क्या आप…" (have you…). I could not tell whether they meant me or her.
- The "जो कागज़ात अभी नहीं मिले" (missing papers) list includes papers it then says were "मिल गया है" (received).
- When I switched to English and later opened the app again, it was back in Hindi.
- The consent page frightened me. It shows a "मसौदा — क़ानूनी समीक्षा बाकी" (draft, legal review pending) label, empty "[ ]" brackets and the words HIPAA and DPDP.

**Mohd. Abdul Rahim Khan (patient, English, diagnosis shared).** The home page is clear, and showing the "OncoSetu" name is right for him. The missing-papers list is messy: four cards that each just say "Imaging report", with no date and no hospital. Making a share link was easy: a QR code, a ready-made passcode and a copy button. But the doctor only sees **3 papers, "As of 16 Feb 2026"**, while Khan's own page lists 14. The only warning is a small grey line on the share page. Every link in "Your links" has the same name, so I could not tell which one to switch off.

**Pooja Kulkarni (mother of Aarav, 12).** Sign-in worked. Her file is empty, yet the page says "Nothing is missing right now. Thank you." That is reassuring in the wrong way. The consent page says "Only the patient can change this list", but the patient is a 12-year-old child.

## (b) Findings

| id | severity | page/URL | what happened | screenshot file | suggested change | likely file |
|---|---|---|---|---|---|---|
| PAT-01 | P1 | all `/p/*` | The language choice is not remembered. After Rohan switched to English (`/p?lang=en`), opening `/p` again (bookmark, home-screen icon, SMS link) showed Hindi. The same happened to Khan after he chose Hindi. Only the `?lang=` in the URL carries the choice, and the only cookie is `os_sid`. | rohan-lang-en-home.png, rohan-lang-hi-home.png | Save the choice when the switch is pressed (a cookie, or the patient/caregiver profile), and read it before falling back to `preferredLanguage`. | src/server/portal/context.ts (line 45, `lang: patients.preferredLanguage`); the language switch in src/components/ui/interactive.tsx |
| PAT-02 | P1 | `/p` "Papers still missing" | The missing list includes cards that say "मिल गया है। क्लिनिक टीम इसे जाँचेगी।" / "Received. The clinic team will check it.", followed by "Not sure where to ask?" on the same card. The heading says not received; the card says received. They also use the same crossed-file icon as truly missing papers. | rohan-earlier-dates.png, khan-06-home.png | Move received-but-unchecked items into their own small group: "We got these, the clinic is checking them". Give them a tick icon and drop the "where to ask" line. | src/components/portal/MissingPaper.tsx, src/app/(patient)/p/page.tsx |
| PAT-03 | P1 | `/p`, `/p/requests` (Khan) | Four separate cards each say only "Imaging report", with no date and no hospital. Three of them have "Make a letter for this paper". A family member cannot tell them apart or know which one to chase. | khan-06-home.png, khan-_p_requests-full.png | Give each card something to tell it apart: the paper that mentions it ("Mentioned in your discharge summary, 20 Jan 2026"). Or merge identical undated items into one card: "3 imaging reports mentioned, dates not written". | src/components/portal/MissingPaper.tsx |
| PAT-04 | P1 | `/p/share` then `/s/[id]` | Khan has 14 papers, but the link shows the doctor only the sealed record "As of 16 Feb 2026": 3 papers and no scans. The patient's only warning is a small grey mono line. After creating it, the link is called "Document index and the documents", which suggests the papers themselves are included. **Because of this I could not check that scans appear as "stored at the clinic, not included".** Khan's sealed snapshot has no scans, and Rohan and Pooja cannot share until a visit is sealed. | khan-_p_share-full.png, khan-share-created.png, doctor-share-open-index_with_quotes.png | Above "Create link", say in body text: "The doctor will see 3 papers, the list your clinic checked on 16 Feb 2026. Papers you sent after that are not included yet." Rename the link to match the option picked: "Document list" or "Document list with the words from each paper". | src/app/(patient)/p/share/page.tsx; src/i18n/patient.ts:275 `scope_summary_with_documents`; src/i18n/shares.ts |
| PAT-05 | P1 | `/p/share` "Your links" | Every link has the same title and the same dates. Nothing says who it was for or which option was chosen. With 4 active links I could not tell which one to switch off. | khan-share-created.png, khan-switchoff-confirm.png | Add an optional "Who is this for? (e.g. Dr. Mehta, Pune)" field and show it as the link title. Also show what was shared and the time it was made. | src/app/(patient)/p/share/page.tsx, src/components/portal/RevokeShare.tsx |
| PAT-06 | P1 | `/p/consent` | Patients see internal draft material: the badge "DRAFT — LEGAL REVIEW PENDING / मसौदा — क़ानूनी समीक्षा बाकी", "Notice version dpdp-draft-v1", "Grievance officer: [ ] Contact: [ ]", "To be filled in by the hospital before use", and "Future scope: Aligning with HIPAA…". An anxious family member reads this as "this app is not real or not legal". | rohan-_p_consent-full.png, pooja-_p_consent-top.png | Hide the draft badge, the version string, the empty grievance placeholders and the "Future scope" box from patients. If no officer is set, say "Ask at the clinic desk to raise a complaint." | src/components/portal/ConsentPanel.tsx, src/components/portal/PrivacyNotice.tsx, src/i18n/privacy.ts |
| PAT-07 | P1 | `/p/permissions` | The page is a 9-column table, 765 px wide, inside a sideways scroller at 375 px. The columns are cut off with no hint to scroll. It uses jargon: "हस्ताक्षरित स्नैपशॉट सील करना", "ऑडिट लॉग", "ब्रेक-ग्लास". A family member cannot read it. | rohan-_p_permissions-top.png, rohan-_p_permissions-full.png | On phones, show one card per role with plain lines, e.g. "Front desk: can see the list, cannot open papers". Lead with the patient's and caregiver's own rows. Replace the jargon: "emergency access" for break-glass, "the list of who opened your file" for audit log. | src/app/(patient)/p/permissions/page.tsx |
| PAT-08 | P1 | `/p`, `/p/visit`, `/p/consent` (caregivers) | The caregiver is addressed as if they were the patient: "आपकी फ़ाइल", "क्या आप हाल ही में किसी और अस्पताल… दिखा चुके हैं?", and the review line "आपने नई जाँच या स्कैन करवाई है।". For Pooja (minor patient): "Your rights … what is kept about you" and "Only the patient can change this list." The patient is 12. | rohan-visit-q1.png, rohan-visit-review.png, pooja-_p_consent-full.png | When a caregiver is signed in, use the patient's first name or relation: "आपकी माँ की फ़ाइल" / "Has Sunita seen another hospital recently?" / "Aarav's file". For a minor: "Only the clinic can change this list. Ask at the desk." | src/i18n/patient.ts (homeKicker, visit question keys, cgOnlyPatient line 318), src/components/portal/VisitFlow.tsx |
| PAT-09 | P1 | `/print/request/...` (Rohan) + `/p` | No forbidden word appears anywhere. But Rohan's letter says "Day-care record: cycles 1, 2 and 3 / डे-केयर रिकॉर्ड: चक्र 1, 2 और 3", and "Day-care record" is on his home page. A son who reads "day-care … cycles" may infer chemotherapy before the doctor has talked to the family. This needs a product decision, not a word filter. | rohan-letter-en.png, rohan-letter-hi.png | For patients whose diagnosis is not disclosed, write the letter line as "Day-care visit records up to 5 Jun 2026" and leave out the "cycles" wording. | src/server/requests (letter item text), src/i18n/patient.ts |
| PAT-10 | P1 | `/p` (Pooja) | The file is empty ("Nothing received yet"), yet the top section says "Nothing is missing right now. Thank you." That suggests everything is in order when the clinic has nothing. | pooja-06-home.png | When no papers have been received, replace it with: "The clinic has no papers for Aarav yet. Please send photos of any reports, prescriptions or hospital papers." Put the Send button first. | src/app/(patient)/p/page.tsx |
| PAT-11 | P2 | every `/p/*` page | The "acting for" banner (about 130 px tall) repeats on every page, and it names the patient only as "record SD" / "record AK", which means nothing to the user. | rohan-_p-top.png, pooja-06-home.png | Show it in full on home only. On other pages, use one line: "For: Sunita D. (your mother)". Show the first name, not initials. | src/i18n/patient.ts:30 `actingFor`, src/components/portal/PortalFrame.tsx |
| PAT-12 | P2 | `/p` earlier dates (Hindi) | Untranslated English text appears in a Hindi page: "Next visit", "Suture removal", "Wound dressing at the hospital dressing room". There is no sign that these are exact words copied from the paper. | rohan-earlier-dates.png | Put the quote in quotation marks with a label "काग़ज़ पर लिखा है:". Or translate common ones ("Next visit" → "अगली विज़िट") and keep the original small underneath. | src/app/(patient)/p/page.tsx |
| PAT-13 | P2 | all pages | `<html lang="en">` stays even when the page is in Hindi or Hinglish, so a screen reader reads Hindi with an English voice. | (DOM check, no image) | Set `lang` from the resolved portal language (`hi`, `hi-Latn`). | src/app/layout.tsx:32 |
| PAT-14 | P2 | `/p`, `/p/requests` (Hindi) | Word choice is stiff and inconsistent. Rohan sees "प्रयोगशाला रिपोर्ट"; Khan's Hindi page says "लैब रिपोर्ट". Hard jargon: "इनडोर रिकॉर्ड", "IMC विनियम 1.3.2". | rohan-_p_requests-full.png, khan-hindi-home.png | Use "लैब रिपोर्ट" everywhere. Say "भर्ती के दौरान के रिकॉर्ड" instead of "इनडोर रिकॉर्ड", and keep the regulation number only on the printed letter. | src/i18n/patient.ts, src/core/copy/index.ts |
| PAT-15 | P2 | `/p/upload` | Re-sending a paper the clinic already has shows "यह हमारे पास पहले से है। धन्यवाद।" on the file, then a green box "मिल गया। क्लिनिक टीम इसे जाँचेगी।". The two messages say different things. | rohan-upload-duplicate.png, rohan-upload-done.png | When every file was a duplicate, make the box say "We already had this. Nothing new to check." | src/components/portal/UploadForm.tsx |
| PAT-16 | P2 | `/p/upload`, `/p/abdm`, menu | Features that do not exist yet take up space: the "Forwarding from WhatsApp or email: Coming soon" section, and a full menu item "अस्पताल रिकॉर्ड" whose page says "Planned: not live yet". | rohan-_p_upload-full.png, rohan-_p_abdm-top.png | Remove both from the patient UI until they work. | src/i18n/patient.ts:138, src/components/portal/PortalNav.tsx |
| PAT-17 | P2 | `/p/upload` | "आप जो भेजते हैं, क्लिनिक उसे आपकी फ़ाइल में रखता है। यह आप 'गोपनीयता और सहमति' पेज पर बदल सकते हैं।" It is not clear what "यह" (this) can be changed. It sounds as if you can stop the clinic keeping papers you send. | rohan-_p_upload-top.png | Remove the sentence, or say "You can choose how the clinic uses your papers on the Privacy page." | src/i18n/patient.ts |
| PAT-18 | P2 | `/p` "Show all 14" | The summary stays "Show all 14" when opened, and it sits between the first 3 papers and the rest. There is no "Show fewer". | khan-show-all.png | Change the label to "Show fewer" when open, or move the toggle below the list. | src/app/(patient)/p/page.tsx (docsShowAll) |
| PAT-19 | P2 | `/print/request/[id]` | The letter page has only "Print / Save as PDF" and EN/हिं. There is no way back to the app on a phone except the browser's back button. | khan-letter-nohospital-print.png, rohan-letter-hi.png | Add a "← Back to my requests" link in the toolbar, hidden when printing. | src/app/print/request/[id]/page.tsx |
| PAT-20 | P2 | `/p/share` | Technical copy: "The key that opens the link is part of the link itself. It stays on this device and is never sent to the server." The hint "At least 6 characters" stays even though the app already filled the passcode. The page uses uppercase mono labels ("CREATE LINK", "LINK WORKS FOR") unlike the rest of the portal. There is no WhatsApp share button. | khan-_p_share-full.png, khan-share-created.png | Replace with "Send the link and the passcode separately, for example the link by WhatsApp and the passcode by a phone call." Add a "Share on WhatsApp" button. Use sentence-case labels like other pages. | src/i18n/shares.ts:89, src/app/(patient)/p/share/page.tsx |
| PAT-21 | P2 | `/s/[id]` (outside doctor) | Several small issues: the grammar error "1 papers"; the "PRINT" button is 87x36 and "Verify seal" is 25 px tall (below 44); the decorative marquee "VISIT SEALED · RECORD LOCKED"; and "SHA-256 333c…" text on a phone. | doctor-share-open-index_with_quotes.png | Write "1 paper"; make the controls at least 44 px tall; keep the hash behind "Verify seal". | src/components/shares/ShareViewer.tsx:24 `nPapers` |
| PAT-22 | P2 | `/p/login` | The demo-accounts block (about 700 px) sits above the real form. After tapping a person, "The code is filled in. Press Sign in." appears, but the Sign in button is below the fold. | r01-login.png, login-demo-button.png | Put the number form first and the demo block below it, or scroll to the Sign in button after a demo pick. | src/components/portal/LoginForm.tsx |
| PAT-23 | P2 | `/p/requests` (Khan) | The card says "Not sure where to ask? The clinic desk can help.", but the letter it makes is addressed to "Synthetic Demo Imaging Centre". | khan-letter-nohospital.png, khan-letter-nohospital-print.png | If a hospital is known, show "Ask at: …" on the card. If none is known, leave the letter's "To" line blank for the family to fill in. | src/components/portal/MissingPaper.tsx, src/components/portal/LetterButton.tsx |
| PAT-24 | P2 | `/p/share` | "Switch off" acts at once, with no confirm and no undo. | khan-switchoff-confirm.png | Ask "Switch off this link? The doctor will no longer be able to open it." with Cancel / Switch off, as withdrawing a letter already does. | src/components/portal/RevokeShare.tsx |
| PAT-25 | P2 | `/p/access` | "Someone tried a shared link with a wrong passcode on a computer" appears with no advice. This is alarming for an anxious family. | khan-_p_access-full.png | Add: "If this was not your doctor, switch the link off on the Share page." and link to it. | src/app/(patient)/p/access/page.tsx |
| PAT-26 | P2 | `/s/[id]` | A wrong passcode or a switched-off link logs console errors (`401`/`410` on `POST /api/shares/[id]/open`). The page itself handles both well. | doctor-share-wrongpass-index_with_quotes.png, doctor-share-switched-off.png | Optional: return 200 with a status field, so normal states are not logged as errors. | src/app/api/shares/[id]/open |

**Counts: P0 0 · P1 10 · P2 16.**

## (c) What worked well (keep it this way)

- **Diagnosis not disclosed is respected.** For Rohan, every portal page in Hindi, English and Hinglish had no cancer or diagnosis word. I checked visible text and markup with a word list in both scripts. The same was true of both printed letters, the new letter I made, the upload results and the SMS. The brand reads "Setu Records", and hospital and lab names are neutral (TRIVENI MULTISPECIALITY HOSPITAL, KASTURI DAY-CARE UNIT). Khan (diagnosis shared) correctly sees "OncoSetu".
- Sign-in with the demo phone works with no help. Errors are clear: "Please enter a valid mobile number." and "That code is not right or has expired…".
- Home puts missing papers first, each with one big action. The Hindi page opens in Hindi for Rohan.
- **No horizontal page scroll on any page at 375 px.** All portal buttons and links are at least 44 px, except the doctor view (PAT-21).
- Dates are always day-month-year ("5 जून 2026", "19 Nov 2026").
- No console errors and no 4xx/5xx on any portal page load.
- Visit questions: one question per screen, large buttons, a clear review step ("कृपया जाँचें कि हमने क्या समझा") and a thank-you screen.
- Letters: the in-page confirm "यह अनुरोध वापस लें? यह इतिहास में रहेगा।" is good. The printed letter is clean, in English and Hindi, with a QR return code. "अस्पताल को अपने-आप कुछ नहीं भेजा जाता" is reassuring.
- "Something wrong with this?" uses reason codes and gives the clear result "You told us something is wrong… The records team will look at it again."
- Sharing: the passcode is generated for you, there is a QR code and a copy button, and "Attempts left: 4" shows on a wrong passcode. A switched-off link says "This link is no longer available. Ask the person who shared it for a new link." Rohan and Pooja get a plain explanation of why they cannot share yet.
- The footer "A list of documents, not a medical summary" and the upload line "यह तस्वीरों की व्याख्या नहीं करता" make it clear the app does not diagnose. **I found no claim of diagnosis or advice anywhere.**
- Hinglish reads naturally ("Kaagazaat jo abhi nahi mile", "Letter ban chuka hai. Hospital ke jawab ka intezaar hai.").
- Sign out goes back to login in the same language, and `/p` then redirects to login (the back button does not show the file).

## (d) Coverage

Personas: Rohan (Hindi, then EN and Hinglish), Khan (EN, then Hindi), Pooja (EN). An outside doctor in a fresh browser context.

Pages:
- `/p/login`
- `/p`
- `/p/upload`
- `/p/requests`
- `/p/visit`
- `/p/share`
- `/p/abdm`
- `/p/consent`
- `/p/permissions`
- `/p/access`
- `/print/request/[id]` (EN and HI)
- `/s/[id]`

Each page was checked for overflow, touch targets, console errors and HTTP errors in the persona's language. Rohan's pages were also checked in all 3 languages for forbidden words.

Buttons and controls tried:
- **Login:** typing a number; Send code; Demo phone, then Show latest message; typing the code; Sign in; an invalid number; a wrong code; the demo person button. Seen but not pressed: Send a new code, Use a different number, Hospital staff link.
- **Header:** EN / हिं / Hinglish switch (and whether the choice persists); Menu open and all 9 menu links listed; Sign out (and the back button after sign-out).
- **Home:**
  - Send it / भेजें links
  - Make a letter for this hospital
  - पत्र देखें
  - Earlier dates expander
  - Send documents card
  - Something wrong with this? (opened and cancelled as Rohan; submitted "Something else" as Khan, with made-up data)
  - Show all 13/14
  - all 5 "More" cards
- **Upload:** Choose files with a duplicate PDF (`hero__04-prescription-printed.pdf`), a new JPG (`hero__05-prescription-handwritten.jpg`) and a DICOM (`hero__20-breast-ultrasound.dcm`), all from `public/demo-docs`; "What can I send?" expander; More / Back home. The "Take photo" input is present; no camera in headless.
- **Requests:**
  - Make a letter for this hospital (Rohan) and Make a letter for this paper (Khan)
  - Letter · English and Letter · Hindi
  - Withdraw, then confirm (both letters I made were withdrawn, to clean up)
  - Seen but not pressed: Mark as given, Could not be obtained
- **Visit:** all 5 questions as Rohan; Yes / No / Not sure; Back; the free-text box shown on "Yes" at Q5; review; "हाँ, यह सही है". Seen: Change my answers, the voice-typing button.
- **Share (Khan):** both "What to share" options; link length; the passcode toggle; Create link; Copy link (present); Create another link (present); opening the link in a fresh context (gate, wrong passcode, right passcode, "What it contains"); Switch off ×3 (all 3 links I made); the dead link afterwards.
- **Consent:** read only. I did **not** press "Withdraw my permission", "Sign and save", "Save my acknowledgement" or any toggle. Shared demo data is used by other auditors and these are hard to undo.
- **Access:** read only. I did **not** press "My card is lost: stop it", because it would disable the demo card for the front-desk auditors.
- **Not tested:** the "stored at the clinic, not included" scan line in a shared link. No persona had a sealed snapshot with scans (see PAT-04).

Side effects I left in the shared demo data, all made-up:
- Rohan: visit answers saved; one duplicate and two new uploads.
- Khan: one "Something wrong" flag on his latest Lab report (20 May 2026); three share links, all switched off.
- Rohan and Khan: one draft letter each, both withdrawn.
