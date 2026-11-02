-- Global LLM call budget (free-tier Gemini key is shared by every org and instance).
-- The app role never touches the table directly: it reserves and settles calls through SECURITY DEFINER functions that
-- serialise on one advisory lock, so concurrent serverless instances cannot overshoot the per-minute / per-day limits.
CREATE TABLE IF NOT EXISTS llm_calls (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,
  model text NOT NULL,
  outcome text NOT NULL DEFAULT 'reserved'
    CHECK (outcome IN ('reserved', 'ok', 'schema_error', 'provider_error', 'rate_limited'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS llm_calls_at_idx ON llm_calls (at);
--> statement-breakpoint
ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE llm_calls FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON llm_calls FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON llm_calls FROM oncosetu_app;
--> statement-breakpoint
-- Reserve one call. Returns (call_id, NULL) when allowed, or (NULL, reason) with reason cooldown | rpm | rpd.
-- Day = Gemini's quota day (midnight US Pacific). A provider 429 starts a cooldown for every instance.
CREATE OR REPLACE FUNCTION llm_reserve(p_provider text, p_model text, p_rpm int, p_rpd int, p_cooldown_s int)
RETURNS TABLE (call_id bigint, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n_min int;
  n_day int;
  last_limited timestamptz;
  day_start timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles')) AT TIME ZONE 'America/Los_Angeles';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('oncosetu:llm_quota', 0));
  DELETE FROM llm_calls WHERE at < now() - interval '30 days';
  SELECT max(at) INTO last_limited FROM llm_calls WHERE outcome = 'rate_limited';
  IF last_limited IS NOT NULL AND last_limited > now() - make_interval(secs => p_cooldown_s) THEN
    RETURN QUERY SELECT NULL::bigint, 'cooldown'::text; RETURN;
  END IF;
  SELECT count(*) INTO n_min FROM llm_calls WHERE at > now() - interval '60 seconds';
  IF n_min >= p_rpm THEN RETURN QUERY SELECT NULL::bigint, 'rpm'::text; RETURN; END IF;
  SELECT count(*) INTO n_day FROM llm_calls WHERE at >= day_start;
  IF n_day >= p_rpd THEN RETURN QUERY SELECT NULL::bigint, 'rpd'::text; RETURN; END IF;
  RETURN QUERY INSERT INTO llm_calls (provider, model) VALUES (p_provider, p_model) RETURNING llm_calls.id, NULL::text;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION llm_settle(p_id bigint, p_outcome text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE llm_calls SET outcome = p_outcome WHERE id = p_id AND outcome = 'reserved'
    AND p_outcome IN ('ok', 'schema_error', 'provider_error', 'rate_limited');
$$;
--> statement-breakpoint
-- Usage for the admin console: calls in the last minute, today (Pacific day), and when a 429 cooldown ends.
CREATE OR REPLACE FUNCTION llm_usage(p_cooldown_s int)
RETURNS TABLE (last_minute int, today int, cooldown_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    (SELECT count(*)::int FROM llm_calls WHERE at > now() - interval '60 seconds'),
    (SELECT count(*)::int FROM llm_calls
      WHERE at >= (date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles')) AT TIME ZONE 'America/Los_Angeles'),
    (SELECT max(at) + make_interval(secs => p_cooldown_s) FROM llm_calls WHERE outcome = 'rate_limited'
      HAVING max(at) + make_interval(secs => p_cooldown_s) > now());
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION llm_reserve(text, text, int, int, int) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION llm_settle(bigint, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION llm_usage(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llm_reserve(text, text, int, int, int) TO oncosetu_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llm_settle(bigint, text) TO oncosetu_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llm_usage(int) TO oncosetu_app;
