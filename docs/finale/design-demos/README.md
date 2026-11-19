# OncoSetu design demos (for approval)

Six small before/after pictures of possible UI changes. Nothing in the app code was touched. Every AFTER is an HTML/CSS mock-up with synthetic data only (Sunita Deshmukh, Mohd. Abdul Rahim Khan; scans are drawn placeholders marked SYNTHETIC). Every BEFORE is a real screenshot of the live site (read-only, demo accounts).

Files: `A.png` to `F.png` (1200x675), `contact-sheet.png` (1920x1080), `after-full/` (each mock-up at 2x for close reading), `shots/` (the 1366x768 and phone screenshots of the live site), `source/` (HTML + Python to re-render).

Safety cues kept in every mock-up: "stored, not read" / "shown, not interpreted", quotes with a "source p.1" link, "document index, not a clinical summary", "not in file does not mean it was not done". No emoji; icons are line SVGs.

Database used: UI UX Pro Max 2.13.0, `src/ui-ux-pro-max/data/*.csv`. Row numbers below are the `No` column.

| Dir | Idea | Effort | Approve? |
|---|---|---|---|
| A | Minimal clinical | M | ( ) |
| B | Calm medical palette, soft cards | M (tokens alone: S) | ( ) |
| C | Doctor "All records" feed + dark reading room | L | ( ) |
| D | Simple Hindi-first phone portal | M | ( ) |
| E | Typography swap | S | ( ) |
| F | Navigation: 11 tabs to 5 + next step | M | ( ) |

## A. Minimal clinical (before: Khan overview)
- Change: one accent (teal), one big number ("3 papers are not in the file"), zero-counts as a quiet list instead of four boxed cards, tour button becomes a small help link, demo banner moves to a footer note.
- Colours (current app tokens, no change): ink `#1B1C1A`, setu teal `#0F6E6A`, tint `#E2EFED`, page `#FAF9F6`, hairline `#EBE8E1`.
- Fonts: unchanged (Instrument Sans).
- DB rows: styles #1 Minimalism & Swiss Style, styles #8 Accessible & Ethical (16px+, 4.5:1, visible focus); products #58 Medical Clinic (primary style Accessible & Ethical + Minimalism & Swiss); ux-guidelines #36 contrast 4.5:1, #39 heading hierarchy.
- Effort M: rework the "First look" cards and header; no data or logic change.

## B. Calm medical palette (before: clinician patient list)
- Change: the wide table (Consent and Record code are cut off at 1366 px) becomes soft cards; status chips have icon + words; the row that needs a look is tinted.
- Palette, colors.csv #58 Medical Clinic: Primary `#0891B2`, Secondary `#22D3EE`, Accent `#16A34A`, Background `#F0FDFA`, Foreground `#134E4A`, Card `#FFFFFF`, Muted `#E8F1F6`, Border `#CCFBF1`, Destructive `#DC2626`. Related: #182 Patient Portal (`#0284C7`, bg `#F0F9FF`, fg `#0C4A6E`, border `#BAE6FD`), #8 Healthcare App (bg `#ECFEFF`).
- Deviation to decide: the row's "On Primary" is `#000000` because white on `#0891B2` is only 3.68:1 and white on `#16A34A` is 3.3:1. The mock uses a darker `#0E7490` (5.36:1) for filled buttons and avatars. Status chip tints (amber `#FEF3C7`/`#92400E`, green `#DCFCE7`/`#166534`, red `#FEE2E2`/`#991B1B`) are my own Tailwind-style values, not DB values.
- Fonts: unchanged. Radius 16px (today 1 to 2px).
- DB rows: styles #19 Soft UI Evolution; products #58 and #8; ux-guidelines #37 colour is not the only signal; ui-reasoning #8 Healthcare App (anti-patterns: neon, motion-heavy, AI purple/pink gradients).
- Effort M (S for the colour tokens alone; M for list-as-cards and mobile reflow).

## C. Doctor "All records" (before: Documents tab; the radiologist's request)
- Change: one feed of every report, scan, lab and prescription, newest first (toggle oldest first), filter chips Reports / Scans / Labs / Prescriptions plus a body-part filter, scan thumbnail beside its report, "earlier same body part" chips. The dark "reading room" puts two scans side by side with the report quote under each and a filmstrip of all scans of that part.
- Light: current warm-grey tokens (`#F5F4F0`, `#FAF9F5`, quote highlight `#FFECB3`). Dark: page `#0B0D10`, panel border `#1F2328`, text `#D9DCE0`, selection `#4AA3FF`, quote bar `#FFD84A`.
- Fonts: unchanged (Instrument Sans; JetBrains Mono for image overlays).
- DB rows: ui-reasoning #182 Patient Portal / Health Records (must-have lab-results-timeline); styles #7 Dark Mode (OLED); ux-guidelines #28 visible focus, #36 contrast.
- Effort L: needs a body-part and modality tag per scan (the app does not interpret images, so the tag must come from the report text or staff entry), thumbnails, a synced two-pane viewer, and a date-merge of all document kinds. Open question for the product owner: does side-by-side viewing stay inside "stored, not read"? The mock keeps that line visible.
- Note: Khan's real demo file has no scans, so this mock uses Sunita Deshmukh with invented items.

## D. Simple patient portal on a phone (before: Khan portal home, 375x812)
- Change: 4 big actions (Send papers, My papers, Questions before your visit, Papers still missing), Hindi first with English beneath, one filled primary button, 3 bottom tabs (Home, Papers, Help); the menu bar and long intro are removed.
- Colours, colors.csv #182 Patient Portal (`#0284C7` family). The mock uses `#0369A1` for the filled button and active tab (white text 5.93:1; `#0284C7` gives only 4.1:1), bg `#F0F9FF`, text `#0C4A6E`, border `#BAE6FD`, muted `#E8F2F8`.
- Fonts: Figtree + Noto Sans Devanagari (typography #30 Medical Clean pairs Figtree with Noto Sans).
- DB rows: ux-guidelines #22 touch target 44/48, #23 8px gaps, #67 16px body; app-interface #6 touch target size, #10 bottom tabs 3 to 5; products #57 Senior Care (large touch targets, high contrast); colors #182.
- Hindi strings are my draft; a native speaker should review them before use.
- Effort M.

## E. Typography swap (before: admin overview)
- Change: Figtree headings + Noto Sans body (+ Noto Sans Devanagari, already in use), sentence-case labels instead of letter-spaced mono capitals, tabular numerals for counts.
- Current (from `src/app/layout.tsx`): Instrument Sans, Inter Tight, JetBrains Mono, Noto Sans Devanagari. Proposed: Figtree 600 headings, Noto Sans 400/500 body at 16px, line-height 1.6. DB alternative: Lexend + Source Sans 3 (#16 Corporate Trust: enterprise, government, healthcare, accessibility-focused).
- DB rows: typography.csv #30 Medical Clean (Figtree / Noto Sans; "healthcare, medical clinics, pharma, health apps, accessibility"), #16 Corporate Trust, #5 Minimal Swiss (single Inter for dashboards; not chosen); ux-guidelines #67, #72 line-height 1.5 to 1.75, #50 font-display swap.
- Effort S: swap the `next/font` imports and the `--font-*` tokens, then re-check line breaks and the mono-capital label styles.

## F. Navigation simplification (before: Documents tab, tab row)
- Change: 11 patient tabs become Overview, Records (Documents + Timeline), To do (What's new + Missing papers + Requests), People & consent (Share links, Consent & access, Patient's own answers), More (Pre-auth file, Activity log). A "Next step" card at the top of Overview says what to do first. Top bar: Patients, Today, avatar.
- Colours: current tokens; amber count (`#F9EED6` / `#875500`) only for items that need action.
- Fonts: unchanged.
- DB rows: app-interface #10 bottom tabs 3 to 5, extras under More/Settings (applied here to a top tab bar); ux-guidelines #3 active state, #79 empty states "helpful message and action" (closest rule for the next-step card). The admin console also has 11 tabs and could use the same grouping.
- Effort M: routes stay the same; group them under 5 tabs with sub-navigation and add a next-step rule (first non-empty of: new, missing papers, held).

## Notes
- Search was done with Python over the CSVs (keyword match on health, medical, clinic, patient, dashboard, accessibility), not with search.py.
- Live pages captured: landing, clinician patient list, Khan overview, Khan Documents tab (top, and the Document index), phone portal home, admin overview (in `shots/`). The landing page is captured but no direction targets it.
