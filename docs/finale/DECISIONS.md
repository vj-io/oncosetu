# Finale decisions (orchestrator)

Every work package follows these. Garv can overrule any of them; the date in brackets is when it was decided.

## Product decisions (19 Nov)
1. **Families can make request letters themselves.** The letter comes from the patient portal. WP3 builds `POST /api/p/requests {missingId, lang}` and WP1 calls it. It uses the same letter text and the same rule for keeping words that could reveal a diagnosis out of the hospital name.
2. **Keep the "Stage / Markers / Margins, as written" sections** for doctors. Collapse a section when it is empty, and hide it completely when every section is empty.
3. **Scan–report pairing is proposed by the system and confirmed by a person.** Until someone confirms, show it as "Possible match". Never auto-link silently.
4. **Earlier scans side by side are allowed:** same patient, same body part or modality, display only. No measuring, no annotation, no "change" wording. The label is "Earlier study, for comparison. OncoSetu does not read images."
5. **Dates default to day/month (Indian format).** Show both readings only when the document itself shows US format.
6. **Live demo data:** only Vaibhav resets it. We ask him to reset right before the finale. Nobody uploads to the demo org on live.
7. **The visual style (colours, fonts, spacing) waits for Garv's pick from `design-demos/`.** Until then, nobody changes `src/app/globals.css` or the design tokens. Layout and structure work can go ahead.

## Garv's answers (19 Nov, late)
8. **Home page:** keep the short version (three entry cards plus the "does not stage, read scans or suggest treatment" line).
9. **/security headline:** DPDP Act and ABDM only. Drop the "formal HIPAA compliance is on our roadmap" promise from the headline; the HIPAA safeguards stay further down the page.
10. **Patient tabs:** keep Overview, All records, What's new, Missing papers, Requests, Share links. The rest go under More.
11. **Doctor landing tab:** Overview. All records is one click away.
12. **Share links and scans:** list each scan as "stored at the clinic, not included" so the outside doctor knows it exists.
13. **Study form:** a small link on Overview after a visit is sealed. No popup.
14. **DICOM download for PACS:** not in this version. View only.
15. **Live demo:** Vaibhav resets the night before; DEMO.md tells judges not to upload to Sunita.
16. **Real scans test:** after browser testing, as the last check.
17. **Push:** not yet. Keep feat/finale-polish local for now.
18. **Visual style:** decide after browser testing. Until then, decision 7 stands (no colour or font changes).

## How we work
- Each package has its own branch `finale/wpN-<name>` cut from `feat/finale-polish`, in its own folder `C:\Users\GARV BANSAL\Documents\onco-wt\wpN`, and touches only the files it owns (see AUDIT.md §5). Commit and push often. The orchestrator merges into `feat/finale-polish`.
- The local database is shared on port 54600 and the app runs on port 3000 from the main folder. Each package runs its own server on port 3100+N for testing. WP6 reseeds, so it uses its own database on port 54601.
- Never touch the live site or the live database. Real patient files are never committed or uploaded anywhere.
- Commits are short, plain sentences ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before pushing: unit tests, typecheck, lint and build all pass. Add tests for new logic.

## Garv's answers (20 Nov)
19. **Desk reopening from "Today's encounters" (DESK-02): same day only.** If today's check-in was verified (SMS code or witnessed in person), desk staff can reopen that record until the end of the day (IST). For any earlier encounter they need a fresh code or witness. Every reopen is audited.
