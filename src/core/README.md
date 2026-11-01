# `src/core` — pure core logic (public API)

Deterministic, no DB / network / filesystem at runtime, no `Date.now()` (pass `now`). Tested with Vitest
(`npm test`). Import from the module folder, e.g. `import { runGate } from '@/core/gate'`.

**Client-safe:** `types`, `copy`, `dates`, `identity`, `extract`, `canonical` (canonical JSON; also re-exported by `ledger`).
**Server-only** (use `node:crypto` via `hash.ts`): `gate`, `radar`, `ledger`.

Dates are `YYYY-MM-DD` calendar strings; a month/year-precision date is stored as its first day plus a
`precision`. Timestamps are ISO strings and are read in IST (+05:30) when a calendar day is needed.

---

## `types.ts`

Const arrays + union types (use the arrays for zod enums / DB enums):

| Export | Values |
|---|---|
| `EVENT_TYPES` / `EventType` | PRD §7.2 (15 types) |
| `EXTRACTABLE_EVENT_TYPES` | all except `document_received`, `patient_statement` |
| `EVENT_FIELDS: Record<EventType, string[]>` | per-type field allow-list (the gate and the LLM prompt use it) |
| `DOC_TYPES` / `DocType` | `pathology_report, ihc_molecular_report, imaging_report, lab_report, prescription_printed, prescription_handwritten, discharge_summary, consult_note, chemo_daycare_record, radiotherapy_summary, procedure_note, bill_insurance, other` |
| `SOURCE_TYPES`, `EXTRACTION_METHODS`, `VERIFICATION_STATUSES` | PRD §7.3 exactly |
| `EVENT_FLAGS` / `EventFlag` | `patient_confirmed, conflict, low_confidence, identity_warning, date_ambiguous, date_unknown, date_future, late_received, binding_uncertain` |
| `DATE_PRECISIONS` | `day, month, year, unknown` |
| `MISSING_STATES`, `REQUEST_STATES`, `DISCLOSURES`, `CONSENT_PURPOSES` | FR-RAD-03, FR-REQ-03, FR-CON-07, FR-CON-01 (`store, ai, share, abdm, metrics`) |

Record shapes: `CoreEvent`, `CoreEvidence`, `CoreDocument`, `CoreStatement`, `CoreMissingItem`, `FieldValue`
(`string | number | string[]`), `Lang` (`'en' | 'hi'`).

Field conventions: every field value is verbatim text from the quote; `event_date_text` = the date as written;
`event_date` (optional) may be ISO and is accepted only if a raw date in the quote parses to it; `cycle_number`
may be a number. The pipeline sets `CoreEvent.eventDate` from `parseDate(fields.event_date_text)`; events
without a date in their quote use `documentDate` downstream (radar/ledger fall back to it).

## `copy/` (FR-CON-07, FR-RAD-04, FR-REQ-01)

- `lintText(text, rulesets: ('radar'|'legal'|'diagnosis')[]): LintHit[]` — Unicode word-boundary matching
  (works for Devanagari); `[]` = clean. `LintHit = { ruleset, term, match, index }`.
- `RADAR_BANNED` (= `LETTER_BANNED`), `LEGAL_BANNED`, `DIAGNOSIS_WORDS` — term lists (`word*` = prefix).
- `patientDocLabel(docType, disclosure, lang='en')` — neutral label unless `cleared`
  (e.g. `chemo_daycare_record` → "Day-care record", `pathology_report` → "Laboratory report (tissue)").
- `staffDocLabel(docType)` — clinical English label.
- `brandFor(disclosure)` — `'OncoSetu'` if cleared, else `'Setu Records'`.
- `formatDateIN(iso|null, lang='en', precision='day')` — "12 Mar 2026" / "12 मार्च 2026" / "Mar 2026" / "2026".
- `istDate(isoDateOrTimestamp)` — calendar day in IST.
- `copy-lint.test.ts` lints every string exported from `src/i18n/*.ts` with `diagnosis` + `radar`.
  Every string in a catalogue is treated as patient-facing.

## `dates/` (FR-EXT-03, E-DOC-11..14)

- `parseDate(raw, { now?, anchor? }): ParsedDate` → `{ iso|null, precision, flags, raw, alternatives? }`.
  DD/MM/YYYY, DD-MM-YY, DD.MM.YYYY, ISO, "12 Mar 2026", "March 12, 2026", "12th March 2026", "Mar-2026"
  (month), "03/2026" (month), "2026" (year), Hindi month names, Devanagari digits.
  Both parts ≤ 12 and different → DD/MM reading + `date_ambiguous` + `alternatives: [MM/DD]`.
  Relative ("3 weeks back", "last month", "कल") → `date_unknown` unless `anchor` is given ("कल" never resolves).
  Year-less ("12 Mar") needs `anchor`. With `now`, a date after now's IST day → `date_future`.
  Two-digit years pivot on `now` (≤ now+1 → 20xx) or on 50 without `now`.
- `findDates(text): DateSpan[]` → `{ raw, start, end, kind: 'absolute'|'relative' }`, offsets into the original.
- Helpers: `toAsciiDigits`, `addDays(iso, n)`, `daysBetween(a, b)`, `dateRange(iso, precision) → [first, last]`.

## `gate/` (§9.4, FR-EXT-02/05/09/10) — server-only

- `runGate(candidates: Candidate[], pages: GatePage[]): GateResult`
  - `Candidate = { event_type, fields, quote, page_no? }` (LLM `extraction.v1` items and pattern output).
  - `GatePage = { pageNo, text, words?: { t, c, s, e }[] }` (`c` 0..1 or 0..100; `s/e` char offsets in `text`).
  - `accepted: { candidate, evidence, flags }[]` with `evidence = { pageNo, charStart, charEnd, quote,
    quoteSha256, spanConfidence|null, continuation? }`. `quote === page.text.slice(charStart, charEnd)` always.
  - `rejected: { candidate, reason, detail? }[]`; reasons: `unknown_event_type, event_type_not_extractable,
    forbidden_field, field_not_allowed, invalid_field_value, quote_too_short, quote_too_long, quote_not_found,
    field_not_in_quote, date_not_in_quote`.
  - Quote search: stated page first, then all pages; a quote crossing a page boundary is accepted with
    `continuation` + `binding_uncertain`. Matching never splits a letter from its combining marks.
  - `institution_name` / `test_name(s)` may be found in the first 15 lines of the quote's page or page 1.
  - Flags: span mean OCR confidence < 0.80 → `low_confidence`; any word < 0.80 in the span (or page-spanning)
    → `binding_uncertain`.
- `normalise(s)` — collapse whitespace, NFC, trim (no case folding).
- `findNormalised(text, needle) → { start, end } | null` — raw offsets (use it to locate LLM header values).
- Constants: `QUOTE_MIN = 8`, `QUOTE_MAX = 300`, `CONFIDENCE_MIN = 0.8`, `HEADER_LINES = 15`.

## `identity/` (FR-ID-03/04, E-ID-01..05)

- `decideIdentity(patient: PatientIdentity, header: HeaderIdentity, reportDate|null): IdentityDecision`
  → `{ result: 'match'|'mismatch'|'insufficient', score, reasons[], notes[] }`.
  - mismatch: `name_mismatch`, `initial_conflict`, `sex_mismatch`, `dob_mismatch`, `age_mismatch`
    (|header age − age at report date| > 1 year).
  - insufficient: `name_missing`, `name_initials_only`, `single_name_token`, `baby_of_clause`,
    `no_corroborating_field` (name matches but no age/DOB at report date and no equal MRN).
  - notes: `matched_on_alias`, `transliteration_variant`, `mrn_match`, `mrn_differs`, `dob_ambiguous_reading`,
    `age_not_compared_no_report_date`, `patient_dob_unknown`, `sex_not_stated`.
- `PatientIdentity = { name, aliases?, dob?, sex?, mrns? }`; `HeaderIdentity = { name?, age?, dob?, sex?, mrn? }` (raw strings OK).
- Building blocks: `normaliseName(raw)` (honorifics, W/o-S/o-D/o clauses, initials, Devanagari),
  `transliterate(devanagari)`, `phoneticKey(token)`, `jaroWinkler(a, b)`, `compareNames(header, patient)`,
  `parseAge(raw) → years|null`, `normaliseSex(raw) → 'M'|'F'|'O'|null`, `ageOn(dob, date)`.
- Measured on the 360-pair generated labelled set in `identity.test.ts`: mismatch recall 100%, false-match
  rate 0%, true-variant match rate 99.4%.

## `extract/` — no-LLM path + LLM contract

- `extractFallback(pages: {pageNo, text}[], docType?): FallbackExtraction` — classify → header → patterns →
  injection; same shape as `extraction.v1` plus `classification`, `headerSpans`, `injection`. Pass `docType`
  to override (staff tag, handwriting classifier). Items still go through `runGate`.
- `classifyDocument(pageTexts): { docType, confidence 0..1, handwrittenHint: false, scores }` (weak → `other`).
- `parseHeader(pageText): ParsedHeader` — `name, age{years}, sex{sex}, dob, mrn, ids[], reportDate,
  reportedDate, collectionDate, genericDate, institution, referringDoctor`; each is `{ value, start, end }`
  with `value === text.slice(start, end)`; labelled fields also carry `label`, `labelStart`.
- `extractPatterns(pages, docType, header?) → Candidate[]` — procedures, admission/discharge, report-level
  events (pathology/IHC/imaging/lab/consultation), pending/sent reports, chemo cycles (`C4D1`, `Cycle 4`,
  `4th cycle`), radiotherapy completed, dated imaging/HPE mentions, referrals, printed-prescription medication
  blocks (`prescription_printed` only). `prescription_handwritten` → `[]`. Medication events carry no date in
  their quote → use the document date.
- `detectInjection(text) → { flagged, flags: ['prompt_injection_suspected'], hits[] }`.
- LLM contract: `ExtractionSchema` (zod, `extraction.v1`), `ExtractionItemSchema`, `ExtractionHeaderSchema`,
  `EXTRACTION_SYSTEM_PROMPT`, `EXTRACTION_PROMPT_ID = 'extract.v1'`, `EXTRACTION_PROMPT_VERSION = 1`,
  `buildExtractionPrompt(pages, docType)`.

## `radar/` (FR-RAD-01..05, Appendix F) — server-only

- `runRadar({ events, documents, statements, ruleModes?, now, rules? }): { items, closureProposals }`
  - `items: RadarItem[]` = `{ dedupeKey, ruleId, ruleVersion, triggerEventId, triggerKind, expectedTypes,
    window: {from, to}, wording: {en, hi}, neutralWording: {en, hi}, sourceLabel, mode, grouped? }`.
    `wording` is staff copy; **use `neutralWording` on patient surfaces** (no diagnosis words).
  - `closureProposals: { dedupeKey, documentId, note? }[]` — the expected document is now in file
    (`note`: `institution_differs` (E-RAD-01) | `document_date_unknown`). A person confirms.
  - Reconcile: new `dedupeKey` → create `missing_records` row; open row whose key is in `closureProposals` →
    `transitionMissing(state, {type:'receive', documentId})`.
  - Mode: `ruleModes[id]` (the org's recorded clinician review in `rule_states`) wins; absent → `production` only if the YAML says `clinician_reviewed: true`, else `shadow`.
    All starter rules are unreviewed, so everything is `shadow` until a clinician reviews them (FR-RAD-05).
  - Rejected / superseded events, detached documents and triggers dated after `now` are ignored. A trigger's
    own document of the expected type satisfies the rule. Chemo cycles: one grouped item per patient
    ("cycles 1–3"), counting only cycles documented in day-care records.
- `transitionMissing(state, action) → { ok: true, state } | { ok: false, error: 'invalid_transition'|'reason_required' }`;
  actions: `request`, `receive{documentId}`, `confirm`, `reject_match{backTo}`, `unobtainable{reason}`,
  `dismiss{reason}`, `reopen`.
- `RADAR_RULES`, `RULES_YAML` (identical to `rules.yaml`), `loadRules(yaml)` (zod-validated), `RuleSchema`,
  `dedupeKeyFor(ruleId, trigger)` (= sha256(`ruleId:trigger`)[:32]), `formatCycleList([1,2,3,5]) → "1–3, 5"`.

## `ledger/` (FR-LED-01..06, FR-REQ-03) — server-only

- `canonicalJson(value)` — sorted keys, no whitespace, shortest numbers; throws on NaN/Infinity.
- `buildSnapshot(record: LedgerRecord, sealedAt): Snapshot` — `verified[]` / `unverified[]` (labelled
  "Verified" / "Not yet verified" / "Disputed"), evidence **hashes** (no quotes), documents, open production
  missing items, statements. `LedgerRecord = { patientId, events, documents, statements, missing }`.
- `hashSnapshot(snapshot)` — SHA-256 hex of the canonical JSON.
- `diffLedger(prev: Snapshot|null, current: LedgerRecord, now): Ledger` → `{ mode: 'initial'|'diff', sealedAt,
  initial_record, new_since_last_visit, newly_received_older, amended, conflicts, patient_said, missing,
  duplicates_suppressed: {count, ids}, errata }`. Render in `LEDGER_CATEGORIES` order; items are date-ordered
  (initial record: `ONBOARDING_PRIORITY` by document type, then date).
  - new vs older: first covered day of the event date > IST day of `sealedAt` → new; otherwise (or undated) →
    older + `late_received`.
  - amended: `supersedesId` points into the snapshot, or the document is an `amendmentOf` a sealed document.
  - conflicts: same procedure on two dates ≤ 30 days apart; same cycle (and regimen) on two dates; patient
    statement medications not on the nearest prescription within ±30 days. Shown when a side is new.
  - duplicates: same type + date + fields (institution ignored) or from a `duplicateOf` document; earliest kept.
  - errata: snapshot documents now detached/removed, with the withdrawn event ids (FR-ID-06).
- `bulkVerifyEligible({ flags, category?, spanConfidence?, verificationStatus? }) → { eligible, reasons }`.
- `requestState(sentAt|null, now, fulfilledAt?, terminal?) → RequestState` (`reminder_due` at +7 d,
  `open_21d` at +21 d). `REMINDER_DAYS`, `OPEN_DAYS`.
