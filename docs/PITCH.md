# Pitch notes

Notes for the healthathon pitch, from the mentor review on 5 Nov 2026 (Arpit, after testing as Dr. Meera) and the
team's pipeline discussion (Garv). The live walkthrough is [DEMO.md](DEMO.md); this page is what to say around it.

## Open with one patient's story

A biopsy report is sent straight to the surgeon. The patient never gets a copy. Months later, at a new centre, nobody
can find it, and the patient does not know what to ask for or whom to ask.

Then show OncoSetu catching it, with Sunita in the demo:

1. Her discharge summary says a wide local excision was done on 12 Mar 2026.
2. The checklist shows "Histopathology report not in file for the procedure documented on 12 Mar 2026 (Discharge
   summary, p.2)". The patient's page shows the same item in neutral words, with **Ask at: Triveni Multispeciality
   Hospital**.
3. Records staff print a request letter to that hospital.
4. The report arrives (the family uploads or forwards it), and a person confirms that it closes the item.

The missing-records list is the centre of the pitch: it tells the patient exactly which paper to ask for and where.

## Who it is for

Oncology hospitals have **patient navigators**. Show OncoSetu as the navigator's tool: one index of what is in the
file, what is missing and who holds it, with a request letter ready to print. Records officers and clinicians use the
same record. The clinician lands on the patient list and only verifies items whose source they opened.

## Ways in: now and later

Garv's plan has several routes for getting records from hospitals and labs. For the hackathon, lead with the routes
that need nothing from another hospital, and show the rest as the plan.

| Now (built and tested) | Later (in the plan) |
|---|---|
| The patient or family uploads photos or PDFs in the portal | ABDM consent pull as a health information user. This needs 3–6 months of ABDM approval, so the panel runs against a synthetic hospital today |
| Forwarding from the phone. Most lab reports already reach the patient on WhatsApp or by email. To go live, WhatsApp needs a Twilio WhatsApp number (`WHATSAPP_INTAKE_NUMBER`) and email needs an inbound mail domain | Direct API access where a hospital or lab offers it |
| Desk capture at the front desk | The host hospital's own system |
| A records request letter for anything still missing | |

## The patient journey: only what the documents say

The patient's home page shows:

- **What is done:** the papers received, with their dates.
- **What is missing, and where to ask:** each missing paper, with the hospital or lab that mentioned it.
- **The doctor named on the latest papers:** for example "Dr. R. S. Joglekar (Day-care record, 5 Jun 2026)".
- **Dates already written down:** the next visit, suture removal, the next cycle, copied as written.

It leaves out treatment choices, outcomes and "future prospects". Those come from the doctor, and leaving them out keeps
the app from giving medical advice. If the family has not told the patient the diagnosis, the page also hides any
wording that would reveal it.

## Say the 72-hour rule carefully

Do not say "hospitals have to share records within 72 hours". IMC Regulation 1.3.2 provides for inpatient records
within 72 hours of a request, but it binds the physician, and its enforcement is disputed (PRD §2.4). The letter cites it
"for reference", which persuades without threatening. Consumer commissions have treated long delays as a deficiency in
service.

## What changed after the mentor review

All ten problems from the test as Dr. Meera were fixed and redeployed:

- Quotes now start at a sentence.
- New facts, each quoted word for word: allergy statements, follow-up dates, lab result rows, and staff-only diagnosis
  and history sections.
- The ECG part of "ECG / Chest X-ray" is kept, and pending lab reports now appear in the checklist.
- The PET-CT item appears in the checklist, and the confusing "Received" label now reads correctly.
- Amended reports name the report they amend and link to it.
- "Verify opened items" counts only items whose source was opened.
- The Documents page layout no longer overlaps.
- Clinicians land on the patient list.

Patient pages follow the browser's language, and Hinglish is a third language for patient pages, share links and SMS.
