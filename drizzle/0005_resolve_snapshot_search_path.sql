-- 0004 first shipped with `SET search_path = public`; a SECURITY DEFINER function must also pin pg_temp last (like 0001),
-- or a temp table could shadow `snapshots`. CREATE OR REPLACE keeps the grants; the GRANT is repeated to be explicit.
CREATE OR REPLACE FUNCTION resolve_snapshot(snapshot_id uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.org_id FROM snapshots s WHERE s.id = resolve_snapshot.snapshot_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_snapshot(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_snapshot(uuid) TO oncosetu_app;
