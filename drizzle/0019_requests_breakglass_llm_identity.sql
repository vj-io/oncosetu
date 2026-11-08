-- Four small additions in one migration:
--   FR-REQ-06  record_requests.institution_type, for the per-type fulfilment table (NULL = not recorded, older requests).
--   FR-ID-10   break_glass.reviewed_at / reviewed_by: a grant stays an alert on /admin until an org_admin marks it reviewed.
--   PRD §9.6   per-org daily LLM budget (calls and tokens, India day) for every provider; limits in org_settings.
--   FR-ID-07   person_identities: one row per ABHA blind index (patients.abha_hmac, HMAC_KEY), shared by every org's
--              patient row with that ABHA. The app role cannot read it; it learns only a yes/no through
--              person_registered_elsewhere(). Clinical data stays in each org's RLS-isolated rows.
ALTER TABLE "record_requests" ADD COLUMN "institution_type" text;--> statement-breakpoint
ALTER TABLE "record_requests" ADD CONSTRAINT "record_requests_institution_type_ck"
  CHECK ("institution_type" IN ('government', 'private', 'charitable', 'diagnostic', 'clinic', 'other'));--> statement-breakpoint
ALTER TABLE "break_glass" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "break_glass" ADD COLUMN "reviewed_by" uuid REFERENCES "staff"("id");--> statement-breakpoint

-- ── per-org LLM budget ──
-- No FK on llm_calls.org_id: a bookkeeping row (no patient data, deleted after 30 days) must never block deleting an org.
ALTER TABLE "llm_calls" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "tokens" integer;--> statement-breakpoint
CREATE INDEX "llm_calls_org_at_idx" ON "llm_calls" ("org_id", "at");--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "llm_daily_calls" integer NOT NULL DEFAULT 1000;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "llm_daily_tokens" integer NOT NULL DEFAULT 10000000;--> statement-breakpoint
-- Reserve one call. The shared free-tier budget (p_rpm / p_rpd / cooldown, per provider) applies when p_rpm is not NULL;
-- the org's daily budget applies when p_org_id is not NULL. Reasons: cooldown | rpm | rpd | org_calls | org_tokens.
-- The 5-argument llm_reserve from 0011 stays for a deployment still running the previous code; this code does not call it.
CREATE OR REPLACE FUNCTION llm_reserve(p_provider text, p_model text, p_rpm int, p_rpd int, p_cooldown_s int, p_org_id uuid)
RETURNS TABLE (call_id bigint, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n int;
  t bigint;
  last_limited timestamptz;
  max_calls int;
  max_tokens int;
  day_start timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles')) AT TIME ZONE 'America/Los_Angeles';
  org_day timestamptz := (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')) AT TIME ZONE 'Asia/Kolkata';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('oncosetu:llm_quota', 0));
  DELETE FROM llm_calls WHERE at < now() - interval '30 days';
  IF p_rpm IS NOT NULL THEN
    SELECT max(at) INTO last_limited FROM llm_calls WHERE provider = p_provider AND outcome = 'rate_limited';
    IF last_limited IS NOT NULL AND last_limited > now() - make_interval(secs => p_cooldown_s) THEN
      RETURN QUERY SELECT NULL::bigint, 'cooldown'::text; RETURN;
    END IF;
    SELECT count(*) INTO n FROM llm_calls WHERE provider = p_provider AND at > now() - interval '60 seconds';
    IF n >= p_rpm THEN RETURN QUERY SELECT NULL::bigint, 'rpm'::text; RETURN; END IF;
    SELECT count(*) INTO n FROM llm_calls WHERE provider = p_provider AND at >= day_start;
    IF n >= p_rpd THEN RETURN QUERY SELECT NULL::bigint, 'rpd'::text; RETURN; END IF;
  END IF;
  IF p_org_id IS NOT NULL THEN
    SELECT coalesce(max(s.llm_daily_calls), 1000), coalesce(max(s.llm_daily_tokens), 10000000) INTO max_calls, max_tokens
      FROM org_settings s WHERE s.org_id = p_org_id;
    SELECT count(*), coalesce(sum(tokens), 0) INTO n, t FROM llm_calls WHERE org_id = p_org_id AND at >= org_day;
    IF n >= max_calls THEN RETURN QUERY SELECT NULL::bigint, 'org_calls'::text; RETURN; END IF;
    IF t >= max_tokens THEN RETURN QUERY SELECT NULL::bigint, 'org_tokens'::text; RETURN; END IF;
  END IF;
  RETURN QUERY INSERT INTO llm_calls (provider, model, org_id) VALUES (p_provider, p_model, p_org_id) RETURNING llm_calls.id, NULL::text;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION llm_settle(p_id bigint, p_outcome text, p_tokens int) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE llm_calls SET outcome = p_outcome, tokens = p_tokens WHERE id = p_id AND outcome = 'reserved'
    AND p_outcome IN ('ok', 'schema_error', 'provider_error', 'rate_limited');
$$;--> statement-breakpoint
-- The calling org's use today (India day), for its settings page. The org comes from app.org_id, never a parameter.
CREATE OR REPLACE FUNCTION llm_org_usage() RETURNS TABLE (calls int, tokens bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int, coalesce(sum(tokens), 0)::bigint FROM llm_calls
  WHERE org_id = nullif(current_setting('app.org_id', true), '')::uuid
    AND at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')) AT TIME ZONE 'Asia/Kolkata';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION llm_reserve(text, text, int, int, int, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION llm_settle(bigint, text, int) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION llm_org_usage() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llm_reserve(text, text, int, int, int, uuid) TO oncosetu_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llm_settle(bigint, text, int) TO oncosetu_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llm_org_usage() TO oncosetu_app;--> statement-breakpoint

-- ── cross-org person identity (FR-ID-07) ──
CREATE TABLE "person_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "abha_hmac" text NOT NULL UNIQUE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- No grants and no policy: the app role reads and writes it only through the SECURITY DEFINER functions below.
REVOKE ALL ON "person_identities" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON "person_identities" FROM oncosetu_app;--> statement-breakpoint
ALTER TABLE "person_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_identities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "person_id" uuid REFERENCES "person_identities"("id");--> statement-breakpoint
CREATE INDEX "patients_person_idx" ON "patients" ("person_id");--> statement-breakpoint
-- Every write of abha_hmac (registration, merge, erasure's NULL) links or unlinks the person, so no caller can forget it.
CREATE OR REPLACE FUNCTION link_person_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.abha_hmac IS NULL THEN
    NEW.person_id := NULL;
  ELSE
    INSERT INTO person_identities (abha_hmac) VALUES (NEW.abha_hmac) ON CONFLICT (abha_hmac) DO NOTHING;
    SELECT id INTO NEW.person_id FROM person_identities WHERE abha_hmac = NEW.abha_hmac;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER patients_link_person BEFORE INSERT OR UPDATE OF abha_hmac ON patients
  FOR EACH ROW EXECUTE FUNCTION link_person_identity();--> statement-breakpoint
-- The last patient row of a person unlinked (erasure, a corrected ABHA): the blind index goes too (PRD §10.5).
CREATE OR REPLACE FUNCTION drop_orphan_person_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM person_identities pi WHERE pi.id = OLD.person_id AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.person_id = OLD.person_id);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER patients_drop_orphan_person AFTER UPDATE OF abha_hmac ON patients
  FOR EACH ROW WHEN (OLD.person_id IS NOT NULL AND OLD.person_id IS DISTINCT FROM NEW.person_id) EXECUTE FUNCTION drop_orphan_person_identity();--> statement-breakpoint
-- Yes/no only: is this patient (of the caller's org) also an active patient of another org? No org name, no count.
CREATE OR REPLACE FUNCTION person_registered_elsewhere(p_patient_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM patients me JOIN patients o ON o.person_id = me.person_id AND o.org_id <> me.org_id
    WHERE me.id = p_patient_id AND me.org_id = nullif(current_setting('app.org_id', true), '')::uuid AND o.status = 'active');
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION person_registered_elsewhere(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION person_registered_elsewhere(uuid) TO oncosetu_app;--> statement-breakpoint
-- Link the patients registered with an ABHA before this migration.
UPDATE "patients" SET "abha_hmac" = "abha_hmac" WHERE "abha_hmac" IS NOT NULL;
