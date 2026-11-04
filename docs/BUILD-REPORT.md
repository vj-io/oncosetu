# OncoSetu — build report

How the prototype was built from PRD v1.1 (`docs/PRD.md`): the design-system decision, how the work was split across
models, and what was verified. Date: 2 Nov 2026, updated 4 Nov 2026. Live: https://oncosetu-zeta.vercel.app

## 1. Design system — evaluated from the brag-styles kit

The brag-styles kit has 34 art-directed sets. The product's audience is hospital desk staff, records officers and
oncologists (who must trust what they read), and patients or caregivers in India, many of whom have not been told the
diagnosis. The look had to be calm, exact and non-alarming, and the signature move had to act out the core action:
*every fact shown with where it came from*.

| Set | Fit | Verdict |
|---|---|---|
| **Museum Placard** | An exhibit plus its wall label = a fact plus its provenance (WHAT · WHERE · WHO · WHEN). A missing document = an empty frame on the wall. Gallery white, a warm spotlight, mono accession codes. | **Chosen** |
| Swiss Grid | Exact and enterprise-safe; no metaphor for provenance or absence | Runner-up (safer) |
| Transit Map | Fits the pipeline (capture → gate → ledger), not the record itself | Rejected |
| Jaipur Block Print / Shahi Darbar / Maharaja Deco | Indian identity, but festive or royal — wrong register for a cancer clinic | Rejected |
| Ops Desk / Patent Office | Good for dashboards and architecture, cold for patients | Rejected |
| Doodle | Friendly explainer look; would read as unserious for clinical evidence | Rejected (explicitly not the default) |

Translation from video kit to a clinical UI (see `src/app/globals.css`, `src/components/ui/**`, `/styleguide`):
- **Kept:** palette, type (Instrument Sans, Inter Tight, JetBrains Mono; Noto Sans Devanagari added for Hindi),
  frame and placard ornament, spotlight. **Dropped:** the set's deadpan humour and all video-frame rules.
- **Semantic extension** (one hue per meaning, always with a word): brand teal "Setu" (bridge); sage = verified;
  amber = unverified / low confidence; madder = conflict / identity warning; violet = patient said; slate = shadow
  mode; brass gradient only for the sealed-snapshot seal. Each hue ships a `-ink` text variant measured at ≥ 4.5:1 on
  its tint, the page and white (the style guide recomputes the ratios live).
- **Signature move as micro-interactions:** placards fade in after their item; quote highlights sweep in like a
  spotlight; verification presses an ink stamp; sealing presses a brass seal; missing records are dashed empty frames.
  All motion is inside `prefers-reduced-motion: no-preference`; resting CSS is the final state.
- **Safety in the brand:** on patient-facing surfaces the product shows as "Setu Records" until disclosure is cleared,
  because the name "OncoSetu" itself contains "Onco" (FR-CON-07).

## 2. Delegation — 26 subagents, by complexity

Opus orchestrated (plans, contracts in `docs/ARCHITECTURE.md` and `docs/AGENT-RULES.md`, merges, reviews, deploys).

| Phase | Agent (model) | Scope |
|---|---|---|
| Foundation | Foundation (**Opus**) | Schema, migrations, RLS + app role, SECURITY DEFINER lookups, crypto, TOTP/OTP, sessions, route wrapper, hash-chained audit, CSP proxy |
| | Design system (**Opus**) | Museum Placard tokens, 30+ components, shells, landing page, login, style guide |
| | Core logic (**Opus**) | Evidence gate, India date parser, identity matcher, Radar engine + rules, ledger diff, copy lint — 583 tests |
| | Demo documents (**Sonnet**) | 20 synthetic Indian hospital documents (PDF + photographed JPEG, Hindi, handwritten, injected, wrong-patient) |
| Features (parallel) | Pipeline (**Opus**) | Upload safety, OCR (tesseract eng+hin), classification, identity, extraction, gate, Radar recompute, source viewer, eval |
| | Ledger (**Opus**) | Timeline, two-tier verification, Change Ledger, seal + Ed25519, public verify, records queue |
| | Completeness / requests / shares (**Opus**) | Radar UI, Records Request Kit (EN/HI letters, reminders), encrypted share links + viewer |
| | Registration (**Sonnet**) | Wizard, consent per purpose, QR card, desk OTP lookup, caregivers, disclosure, break-glass |
| | Patient portal (**Sonnet**) | OTP login, uploads, pre-visit questions with read-back, consent, access log |
| | Admin (**Sonnet**) | Staff, rule review, audit chain, metrics, measurement study, duplicates merge, settings |
| | Offline capture (**Sonnet**) | PWA, encrypted IndexedDB queue, idempotent sync, device revoke |
| Hardening | README (**Haiku**) | First README from verified facts |
| | Security review (**Opus**, read-only) | Found 1 S1 + 3 S2 issues |
| | Security fixes (**Opus**) | Access guards, desk redaction, signed share payloads, OTP flood limit, lockout reset |
| | Integration fixes (**Sonnet**) | Erasure requests, patient dispute, i18n, RBAC, `resolve_snapshot` |
| | E2E suite (**Sonnet**) | Playwright suite in an isolated org; found and fixed a pool-nesting deadlock |
| | Pool-nesting audit (**Sonnet**) | Every nested connection site fixed and proven under 12× concurrency |
| | Demo seed (**Opus**) | Demo reset that drives the real API; `docs/DEMO.md` |
| Gap closing | Erasure executor (**Opus**) | Retention-gated `erase_patient()` + cron |
| | LLM path + SMS (**Sonnet**) | LLM pipeline tests (found the closed-schema bug), Twilio adapter + outbox delivery |
| | Restore drill + perf (**Sonnet**) | Neon PITR restore drill, 500-event perf gate, loader pipelining |
| | Inbound channels (**Opus**) | Email drop (Postmark) + WhatsApp intake (Twilio) with code-confirmed holds |
| | ABDM HIU (**Opus**) | Transport interface, X25519/HKDF/AES-GCM, consent-gated decrypt, FHIR mapping |
| | Backups (**Opus**) | Encrypted daily backups to private Blob (Mumbai) + verified restore |
| | Perf probe (**Sonnet**) | Co-located FR-LED-07 measurement on Vercel sin1 |
| Completion | Held-out eval (**Sonnet**) | 40 documents written after the rules froze, gold labels, OCR ground truth, CER and macro-F1 in `scripts/eval.ts` |

Totals: 13 Opus (correctness- or security-critical), 12 Sonnet (well-specified features and tests), 1 Haiku
(documentation). Agents ran up to seven at once with explicit file ownership; the orchestrator committed between phases.

## 3. Verification evidence (2 Nov 2026)

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 1,040 passed (53 files) |
| Integration tests (`npm run test:integration`, live DB) | 27 passed — RLS isolation, erasure, inbound, ABDM, backup type round trips, shared LLM budget |
| End-to-end (`npm run test:e2e`, production build) | 42 / 42 passed — PRD V01–V06 plus inbound, erasure, ABDM, perf |
| Offline capture (`tests/e2e/offline-capture.e2e.ts`) | Passed against a production build |
| Extraction eval (`scripts/eval.ts`, `--llm`, 4 Nov) | 0 unsupported facts and 0 handwritten pages extracted on 60 synthetic docs. Tuned set (20): rules 0.949 / 0.962, Gemini hybrid 0.952 / 0.981. Held-out set (40, written after the rules froze): rules 0.889 / 0.646, Gemini hybrid 0.907 / 0.734 (precision / recall; targets 0.95 / 0.85). Classification macro-F1 0.983. OCR CER on photographed printed pages 7.9% (target 5%) |
| FR-LED-07, co-located (`vercel crons run /api/cron/perf-probe`) | PASS — 508-item ledger 1.14 s and 1.21 s in sin1 (budget 2 s) |
| Restore drill (Neon PITR, `scripts/restore-drill.ts`) | PASS — 14 checks |
| Restore from the Vercel-made encrypted backup | PASS — 9 checks, 40 tables, 27,566 rows, 60 signatures, 358 files |
| Migrations (`scripts/check-migrations.mts`) | 11 / 11 match the applied hashes |
| Security review | 1 S1 + 3 S2 + 6 S3 found; all fixed with regression tests |

## 4. Integrations

| Integration | Status |
|---|---|
| LLM extraction | **Live: Gemini free tier** (`gemini-3.5-flash-lite`, fallback `gemini-flash-lite-latest`), behind a Postgres-enforced shared budget (8/min, 200/day, 60 s cooldown after a 429) and in hybrid mode with the rule library. Eval on the 40-document held-out set: precision 0.907, recall 0.734, 0 unsupported facts (58 calls for both sets, all within quota). Daily health check `GET /api/cron/llm-health` |
| SMS / WhatsApp out | Demo mode by decision: messages recorded in the outbox and shown on the demo phone. Twilio adapter built and wire-tested; enable with `TWILIO_*` |
| WhatsApp in / email drop | Demo mode by decision: endpoints built and E2E-tested with signed payloads; enable with Twilio / Postmark accounts |
| ABDM | Demo mode by decision: PRD-specified in-process gateway with real X25519/HKDF/AES-GCM; sandbox client built; enable with HIU registration (`ABDM_*`) |
