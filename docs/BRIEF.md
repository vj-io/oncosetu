# OncoSetu — Project Brief v1.1

**Date:** 30 October 2026 · **Companion to:** PRD v1.1 · **Audience:** team, clinician advisor, reviewers/judges, prospective pilot site

---

## 1. One paragraph

OncoSetu is a records-continuity layer for cancer care in India. A patient's cancer history is scattered across hospitals as paper, phone photos and WhatsApp PDFs; every new centre starts from scratch. OncoSetu captures what the patient carries, extracts facts only when a verbatim quote in the source supports them, shows the clinic which referenced documents are **missing**, generates the request to get them, and shows every returning visit what changed since the last one. It never diagnoses, stages, interprets or recommends. It is built first as an academic project with a clinician-led pilot that **measures** a burden nobody in India has measured.

## 2. Verdict from independent research (30 Oct 2026)

| Dimension | Score /10 | Why |
|---|---|---|
| Problem significance | 8 | ≈1.57M new cases projected for 2025; NCG centres treat >860,000 new patients/yr; 55.7% of rural survivors seek second opinions; median travel 4.3 h to a tertiary centre |
| Solution fit | 6 | Right workflow, right safety boundary; but patient-held-record evidence is equivocal and the burden is unmeasured |
| Novelty / defensibility | 4 | No product combines the four pieces for patient-carried records in India; each piece exists (Eka Care, Triomics, PicnicHealth, SMART Health Links) and is copyable |
| 6-week feasibility | 7 core / 3 full | Core loop is buildable; v1.0 scope as written was not — hence the cuts below |
| Pilot feasibility (6–12 months) | 5 | Needs IEC approval (1–3 months); DPDP obligations bind from 13 May 2027, inside the window |
| Commercial viability today | 3 | No validated payer; Karkinos insolvency is the cautionary tale |
| As academic/hackathon project | 8 | Clear safety story, measurable pilot, clinician on team |
| As a startup today | 3 | Decide after the pilot data, not before |

**Bottom line:** good idea, wrong framing in v1.0. Build the core loop, run the measurement study, let the data decide whether a company follows.

## 3. What changed from v1.0 and why

| Change | Reason |
|---|---|
| **Hero journey = first visit at a new centre (J1 + J4)**, Change Ledger (J2) second | Outside records matter most, and are most often missing, at the first consultation; second opinions are common |
| **Radar presented as a "document-completeness checklist"**, never "care gaps" | CDSCO MDSW guidance (CDSCO/MD/GD/MDSW/01/2026, 21 Jul 2026) turns on intended medical purpose; liability |
| **Non-disclosure is a must-have default**: caregiver-primary accounts, `disclosure_status = unknown` ⇒ neutral copy everywhere, no spoken read-back until a clinician clears it | 46–54% of Indian cancer patients unaware of their diagnosis in published studies; collusion 88.9% within one month of diagnosis |
| **Records Request Kit reworded**: persuasive reference to IMC Reg. 1.3.2, scoped to discharge/inpatient/pathology/imaging, 7- and 21-day reminders, escalation info sheet; no "72-hour clock" | The rule binds physicians for indoor records; enforcement runs through State Medical Councils and consumer commissions; not directly enforceable against hospitals |
| **Evidence gate claims narrowed** + three new controls (omission recall, field binding, OCR-error propagation) | The gate blocks fabrication (Williams 42% class); it cannot see omission (47% class), wrong-date binding or quoted OCR errors |
| **Cut from v1.0:** Ed25519 Passport + verification page → v1.1; TTS/voice → optional flags in v0.5; ABDM HIU mock → v1.1; WhatsApp simulated | Nothing an Indian clinician can verify today; drug-name WER unmeasured; HIU onboarding needs a legal entity and 3–6 months; ABDM averages ≈1.1 linked records per ABHA |
| **Added:** baseline measurement study (§16.4), kill assumptions K1–K5 with gates (§5.5), commercial hypotheses (§19), Week-1 spikes (OCR, name matching, Safari storage) | The pilot's most valuable output is data; feasibility unknowns resolved in week 1 |
| **Citations fixed** | Puducherry paper is 2026, N=192; "one-way" and "84.9% from another state" withdrawn; MIRAGE nuance + RxScribe Bench (Sep 2026); DPDP dates (13 Nov 2025 / 13 Nov 2026 / 13 May 2027) |

## 4. The product in one screen (v1.0 scope)

1. **Capture** — desk tablet (multi-page camera), patient/caregiver OTP upload link, bulk PDF/photo upload. Handwritten pages stored as images, never auto-extracted.
2. **Extract behind the evidence gate** — LLM proposes events with quotes; a deterministic gate accepts only quotes found verbatim in the page text; identity check per document; dates kept separate (event / document / received).
3. **Document index + timeline** — every item shows WHAT, WHERE (page + quote), WHO verified, WHEN. Two-tier verification: records staff verify "matches source"; clinician sees only key items and conflicts.
4. **Missing-Record Radar** — deterministic rules on documented events ("excision documented on 12/03/2026, discharge summary p.2") list referenced-but-absent documents ("histopathology report not in file"). Shadow mode until the clinician advisor reviews each rule.
5. **Records Request Kit** — EN/HI letter the patient/caregiver sends; tracked; fulfilment time measured.
6. **Change Ledger** (returning visits) — diff against the last sealed snapshot: new since last visit · newly received *older* records (clearly labelled) · amended · conflicts · patient said · missing · duplicates suppressed.
7. **Share link** — passcode-protected, expiring, revocable; viewer needs no account; headed "Document index, not a clinical summary"; lists what is *not* in the file.

**Safety defaults:** nothing clinical in the data model or copy (lint-enforced); caregiver-primary and neutral copy unless disclosure is cleared; consent per purpose with one-tap withdrawal checked on use; QR identifies, never authorises.

## 5. Six-week plan (summary)

| Week | Version | Ships |
|---|---|---|
| 1 | v0.1 | Auth, roles, registration + disclosure status, consent, upload/dedupe, audit, staging; spikes on OCR, name matching, Safari storage |
| 2 | v0.2 | OCR, classification, identity check, extraction + evidence gate + binding/OCR-confidence controls, manual mode, eval gate with clinician-abstraction recall |
| 3 | v0.3 | Timeline, snapshots (hash), Change Ledger, two-tier verification, structured questions with text read-back, onboarding mode; **IEC protocol submitted** |
| 4 | v0.4 | Radar + rule library (shadow mode), Records Request Kit, document index, share link |
| 5 | v0.5 | Offline PWA (encrypted queue, idempotent sync), patient intake channels, caregiver delegation, minors; voice/TTS behind flags |
| 6a | v0.6 | Hardening (ASVS L2, backup/restore, break-glass), measurement-study instrumentation, duplicate-patient detection |
| 6b | v1.0 | Hallway test, demo dataset (first-visit hero), demo script + video, pilot + IEC package |
| 7–9 | v1.1 | Passport signing + verification page, ABDM HIU mock, regional languages — **only if K1–K4 look positive** |

Build model: Opus orchestrator plans/briefs/gates and never writes code; Sonnet builds and reviews; Haiku does mechanical work. **A named human reviews every module touching PHI, consent, the gate, identity, Radar, sharing or crypto** — agent velocity is unproven.

## 6. Pilot and measurement study

- **Site:** one NCG member centre's new-referral oncology clinic; one records lead; one clinician champion.
- **Sequence:** IEC submission (week 3) → 2-week baseline with paper forms only → 4-week shadow → go/no-go on K1–K3 → 4-week live.
- **Measures:** missing-record rate at first consultation and clinician-rated impact; repeat-test rate with reason; preparation time; document census (printed / handwritten / image-only); request fulfilment days; non-disclosure prevalence at enrolment.
- **Safety KPIs (any non-zero pauses the pilot):** wrong-patient attachment past seal; unsupported fact displayed as fact; diagnosis words reaching a not-cleared patient surface; privacy incidents.
- **Compliance:** built to DPDP's 13 May 2027 obligations from day one; vendor DPAs; India-hosted inference preferred; no real data before IEC approval.
- **Output:** a report with denominators, shared with the site and published if the IEC permits. This is the deliverable even if the product stops.

## 7. Kill assumptions (go/no-go)

| # | If this is false, stop | Gate |
|---|---|---|
| K1 | Missing outside records affect ≥ 20% of first consultations at the site | After baseline |
| K2 | Desk/navigator staff can spend ≈3 min per new patient | After shadow |
| K3 | Most decision-critical outside content is printed text, not handwriting or imaging discs | After shadow census |
| K4 | IEC approves LLM processing of identifiable records within ≈3 months | Before real data |
| K5 | A payer exists: 3 paid-pilot conversations + 1 LOI | Before incorporating |

## 8. Honest claims (use these words; avoid the others)

- Say: "every displayed fact is traceable to a verbatim source quote"; "document index"; "documents not in file"; "records provided to OncoSetu".
- Never say: "complete history"; "the AI is accurate"; "clinically verified"; "expected after surgery"; "legally required within 72 hours"; "available at any centre".
- Novelty statement: "Longitudinal oncology views exist inside integrated health systems, and consumer apps already collect patient-carried records in India. We have not found a product that, for records carried across unconnected institutions, gates every fact on a verbatim quote, lists referenced-but-absent documents, turns each into a tracked records request, and returns the verified index as an expiring link. Each piece exists; the combination in an Indian oncology intake workflow is what we are testing."

## 9. Known competitors and what to say about them

- **Eka Care** — ABDM PHR with WhatsApp upload, auto-sorting and open-weight document models (Parrotlet, Aug 2026). Intake is not our differentiator; oncology completeness and requests are. Potential partner, not only competitor.
- **Triomics** — $22M Series B (May 2026); pre-visit chart review inside US EHRs; Indian-founded. Works inside one health system; we work on paper carried between unconnected ones.
- **PicnicHealth / Citizen Health** — US patient-mediated retrieval, now monetised through research data. Shows the route works; shows the business model is not subscriptions.
- **Karkinos** — acquired out of insolvency (Dec 2024). Payer clarity before scale.
- **Nirantar Health** (same author) — forward-looking "expected care step not recorded" engine for a hospital's own records. OncoSetu reuses its evidence gate and consent model; its question, users and inputs differ. Cite as prior work.

## 10. Decisions needed now

1. Confirm hero journey = first visit (D1).
2. Name the pilot site and clinician champion for the IEC submission (D10).
3. Confirm `disclosure_status = unknown` ⇒ neutral copy for everyone (D11).
4. LLM hosting for shadow/live: India-hosted vs disclosed foreign API (D12).
5. Academic/pilot project until K1–K5 are tested; no incorporation before (D13).
6. 6-week vs 5-week plan (D9).

## 11. Team

Dr Sona Pungavkar (clinician advisor; reviews Radar rules, owns the measurement forms) · Vaibhav Jangid (technical lead) · Bhavya Dhoot (developer lead) · Garv Bansal (research lead) · Nerav (clinical advisor).

---

*Sources for every figure in this brief are in PRD v1.1 §2.4, §4 and Appendix H.*
