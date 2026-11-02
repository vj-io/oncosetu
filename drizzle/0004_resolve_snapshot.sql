-- Public seal verification (/verify/[id], GET /api/snapshots/[id]/verify): the caller is anonymous, so the org is
-- unknown. Like resolve_share, return the org id only; the snapshot itself is then read under RLS with withOrg.
CREATE OR REPLACE FUNCTION resolve_snapshot(snapshot_id uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.org_id FROM snapshots s WHERE s.id = resolve_snapshot.snapshot_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_snapshot(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_snapshot(uuid) TO oncosetu_app;
