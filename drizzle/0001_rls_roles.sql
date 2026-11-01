-- Hand-written: app role, least-privilege grants, append-only enforcement, RLS, SECURITY DEFINER lookups.
-- The app role's password is set by scripts/migrate.ts (never in SQL). Future migrations that add tables must
-- GRANT to oncosetu_app explicitly and add RLS here-style (no ALTER DEFAULT PRIVILEGES on purpose).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oncosetu_app') THEN
    CREATE ROLE oncosetu_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint
ALTER ROLE oncosetu_app NOBYPASSRLS NOCREATEDB NOCREATEROLE;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO oncosetu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oncosetu_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, verifications, consents, snapshots FROM oncosetu_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER snapshots_append_only BEFORE UPDATE OR DELETE ON snapshots FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER snapshots_no_truncate BEFORE TRUNCATE ON snapshots FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- RLS: keep this list in sync with RLS_TABLES in src/db/schema.ts.
-- nullif(..., '') because a transaction-local setting reverts to '' (not NULL) on a pooled connection.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients', 'patient_aliases', 'caregivers', 'consents', 'encounters', 'documents', 'document_files',
    'document_pages', 'events', 'evidence', 'patient_statements', 'verifications', 'snapshots', 'missing_records',
    'record_requests', 'share_links', 'share_views', 'ai_runs', 'audit_log', 'devices', 'outbox', 'break_glass',
    'measurement_forms', 'rule_states', 'patient_merges'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) '
      'WITH CHECK (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Public routing lookups (QR token, phone, share id). Return ids only; owned by the migration role (BYPASSRLS).
CREATE OR REPLACE FUNCTION resolve_patient_by_token(p_token_hash text)
RETURNS TABLE (patient_id uuid, org_id uuid, token_revoked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.org_id, p.token_revoked_at IS NOT NULL
  FROM patients p WHERE p.oncosetu_token_hash = p_token_hash
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_patients_by_phone(p_phone_hmac text)
RETURNS TABLE (patient_id uuid, org_id uuid, caregiver_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.org_id, NULL::uuid FROM patients p
  WHERE p.phone_hmac = p_phone_hmac AND p.status = 'active'
  UNION ALL
  SELECT c.patient_id, c.org_id, c.id FROM caregivers c JOIN patients p ON p.id = c.patient_id
  WHERE c.phone_hmac = p_phone_hmac AND c.active AND c.revoked_at IS NULL AND p.status = 'active'
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_share(p_share_id uuid)
RETURNS TABLE (share_id uuid, patient_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.patient_id, s.org_id FROM share_links s WHERE s.id = p_share_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_patient_by_token(text), resolve_patients_by_phone(text), resolve_share(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_patient_by_token(text), resolve_patients_by_phone(text), resolve_share(uuid) TO oncosetu_app;
