-- FR-LED-07 production probe (src/app/api/cron/perf-probe/route.ts): one row per run, so the "ledger renders in <= 2 s for a 500-event
-- patient" number is measured where it runs (Vercel sin1 next to Neon Singapore) and kept, instead of a one-off laptop figure.
-- Latency numbers, a region name and counts only: no PHI, no patient or staff ids, no org_id. That is why this is NOT an org_isolation
-- table (there is no tenant to isolate) and is not in RLS_TABLES. RLS is still ENABLED + FORCED, with permissive SELECT and INSERT
-- policies for the app role and none for UPDATE/DELETE, and the grants below are SELECT + INSERT only: rows are append-only, and
-- granting more later would still not let anyone rewrite them. Reading as the owner (scripts/perf-probe-report.ts) bypasses RLS.
CREATE TABLE "perf_probes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- process.env.VERCEL_REGION ('local' off Vercel)
  "region" text NOT NULL,
  -- median of 10 sequential `select 1` on the app pool (ms): the database round trip from that function
  "rtt_ms" real,
  -- median of 3 timed GETs of /patients/<id>/ledger after 1 warm one: first byte, and full body (ms); NULL when nothing was timed
  "ttfb_ms" real,
  "total_ms" real,
  "html_bytes" integer,
  -- ledger cards found in the HTML (the probe needs >= 500)
  "items_found" integer NOT NULL,
  -- loadLedger inside withOrg, median of 3 (ms)
  "loader_ms" real,
  "budget_ms" integer NOT NULL,
  -- pass: total_ms <= budget with all items present; fail: over budget; invalid: bad response or items missing (not a pass, not a fail)
  "verdict" text NOT NULL CHECK ("verdict" IN ('pass', 'fail', 'invalid')),
  -- per-run numbers, how the origin was found, deployment id
  "detail" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "perf_probes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "perf_probes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY perf_probes_read ON "perf_probes" FOR SELECT TO oncosetu_app USING (true);
--> statement-breakpoint
CREATE POLICY perf_probes_insert ON "perf_probes" FOR INSERT TO oncosetu_app WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON "perf_probes" TO oncosetu_app;
