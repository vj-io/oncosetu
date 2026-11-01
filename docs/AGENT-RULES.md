# Rules for every build agent (phase 2+)

1. Read `docs/ARCHITECTURE.md` (contract + cross-feature interfaces), `AGENTS.md`, `src/core/README.md` (if present),
   `src/components/ui/index.ts` + `src/components/shell/index.ts` (use these components; match the Museum Placard look of
   `src/app/styleguide/**` and `src/app/page.tsx`), and the server helpers in `src/server/*.ts` (route(), withOrg,
   requireStaff, assertPatientAccess, assertConsent, writeAudit via ctx.audit, sendMessage, now(), storeFile/readFile,
   encryptField/decryptField, hmac). Before using a Next 16 API, read its guide in `node_modules/next/dist/docs/`.
2. Own only the paths in your brief. Never edit another owner's file; put needed shared changes in your final report.
   No `npm install`. No `git commit`/`push`. No new migrations unless your brief says so (new tables need explicit
   GRANTs to `oncosetu_app` and RLS — see `drizzle/0001_rls_roles.sql`).
3. Server components read via server functions after `requireStaff()`/`requirePatientSession()` + `withOrg()` +
   `assertPatientAccess()`; all mutations are route handlers wrapped in `route()`; every mutation calls `ctx.audit(...)`
   with ids only. Consent is checked on use. Never log or audit PHI (names, phones, quotes, file bytes).
4. Patient-facing strings live in `src/i18n/<feature>.ts` as `{ en, hi }` and must pass `src/core/copy` lint
   (no diagnosis words unless disclosure is cleared; brand via `brandFor(disclosure)`; doc labels via `patientDocLabel`).
5. Real functionality only — no placeholders, mock data, TODO stubs or fake numbers. If something truly cannot be built,
   say so in the report.
6. Dev server: only one `next dev` may run in this directory. Run `npm run dev -- --port 3000` in the background; if it
   prints "Another next dev server is already running", use the URL it prints. Never kill a server you did not start.
   Log in for API/UI checks via `GET /api/auth/demo-accounts` (demo password + live TOTP) → `POST /api/auth/staff/login`
   with header `Origin: <server url>`.
7. Verify before reporting: `npx tsc --noEmit` clean for your files, Vitest tests for any non-trivial logic you wrote,
   and exercise every route/page you built against the running server (curl and/or a Playwright script in
   /private/tmp; view screenshots at 1280px and 375px for UI). Fix what you find.
8. Final report: files, routes, exported functions, test results, known gaps. Concise; no file dumps.
