-- J8 / PRD §10.5: the erasure executor. erase_patient(request) deletes a patient's originals and derived data once the
-- request is due, in the caller's transaction (all or nothing), and leaves a minimal tombstone:
--   kept:    patients row (id, org, status 'erased', timestamps; every identifier nulled or replaced), consents (the legal
--            record of grant and withdrawal: purposes, actor ids, notice version, no PII), the erasure request itself, and
--            audit_log (ids only, legally retained; never touched here).
--   deleted: documents + files + pages, events (all versions), evidence, verifications (+ QA reviews), statements, missing
--            records, record requests, snapshots, share links + views, caregivers, aliases, encounters, sessions, AI-run
--            rows, outbox messages, break-glass grants. Verifications are deleted, not tombstoned: each row references an
--            event (FK) that is being erased and may carry a free-text reason; the audit_log already holds every
--            verification action as ids (event.verify / event.edit ...), which is the trail the law asks us to keep.
--   unlinked: measurement_forms (study data, no patient id) lose their link to the erased encounters.
-- Merged duplicates of the patient (patient_merges executed into it) are the same person and are erased with it.
-- The DB enforces every precondition itself, so no caller (route, cron, psql as the app role) can skip one.
ALTER TYPE "patient_status" ADD VALUE IF NOT EXISTS 'erased';
--> statement-breakpoint
-- Snapshots stay append-only (0001), except a DELETE while erase_patient() runs: it sets the transaction-local flag
-- below and clears it before returning (a refusal rolls the flag back with everything else). UPDATE and TRUNCATE stay
-- forbidden, the app role still has no DELETE grant, and audit_log keeps forbid_mutation() unchanged.
CREATE OR REPLACE FUNCTION forbid_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('oncosetu.erasing', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
DROP TRIGGER snapshots_append_only ON snapshots;
--> statement-breakpoint
CREATE TRIGGER snapshots_append_only BEFORE UPDATE OR DELETE ON snapshots FOR EACH ROW EXECUTE FUNCTION forbid_snapshot_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erase_patient(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org uuid := nullif(current_setting('app.org_id', true), '')::uuid;
  r erasure_requests%ROWTYPE;
  v_ids uuid[];
  v_docs uuid[];
  v_action consent_action;
  v_store boolean;
  t text;
  n bigint;
  c jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO r FROM erasure_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_org IS NULL OR r.org_id <> v_org THEN -- another org's request looks exactly like a missing one
    RAISE EXCEPTION 'erasure_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.state NOT IN ('queued', 'scheduled') THEN
    RAISE EXCEPTION 'erasure_not_open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF r.eligible_after > now() THEN -- real time: a fast-forwarded demo clock can never make data deletable early
    RAISE EXCEPTION 'erasure_not_eligible' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM 1 FROM patients WHERE id = r.patient_id FOR UPDATE; -- serialise with writers on the patient row
  SELECT action, coalesce((purposes->>'store')::boolean, false) INTO v_action, v_store
    FROM consents WHERE patient_id = r.patient_id ORDER BY recorded_at DESC, id DESC LIMIT 1;
  IF FOUND AND v_action <> 'withdraw' AND v_store THEN
    RAISE EXCEPTION 'erasure_consent_active' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  WITH RECURSIVE m(id) AS (
    SELECT r.patient_id
    UNION
    SELECT pm.duplicate_id FROM patient_merges pm JOIN m ON pm.survivor_id = m.id WHERE pm.state = 'executed'
  ) SELECT array_agg(m.id) INTO v_ids FROM m;
  SELECT coalesce(array_agg(d.id), '{}') INTO v_docs FROM documents d WHERE d.patient_id = ANY(v_ids);

  PERFORM set_config('oncosetu.erasing', 'on', true);
  -- Children before parents (FK order). Table names are constants, never input.
  FOREACH t IN ARRAY ARRAY['share_views', 'share_links', 'verification_qa_reviews', 'verifications', 'evidence',
    'record_requests', 'missing_records', 'events', 'patient_statements'] LOOP
    EXECUTE format('DELETE FROM %I WHERE patient_id = ANY($1)', t) USING v_ids;
    GET DIAGNOSTICS n = ROW_COUNT;
    c := c || jsonb_build_object(t, n);
  END LOOP;
  DELETE FROM ai_runs WHERE patient_id = ANY(v_ids) OR document_id = ANY(v_docs);
  GET DIAGNOSTICS n = ROW_COUNT;
  c := c || jsonb_build_object('ai_runs', n);
  FOREACH t IN ARRAY ARRAY['document_pages', 'document_files', 'documents', 'snapshots', 'sessions', 'caregivers',
    'patient_aliases', 'outbox', 'break_glass'] LOOP
    EXECUTE format('DELETE FROM %I WHERE patient_id = ANY($1)', t) USING v_ids;
    GET DIAGNOSTICS n = ROW_COUNT;
    c := c || jsonb_build_object(t, n);
  END LOOP;
  UPDATE measurement_forms SET encounter_id = NULL
    WHERE encounter_id IN (SELECT e.id FROM encounters e WHERE e.patient_id = ANY(v_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  c := c || jsonb_build_object('measurement_forms_unlinked', n);
  DELETE FROM encounters WHERE patient_id = ANY(v_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  c := c || jsonb_build_object('encounters', n);
  PERFORM set_config('oncosetu.erasing', 'off', true);

  UPDATE patients SET
    name_enc = '', dob_enc = NULL, phone_enc = NULL, phone_hmac = NULL, abha_number_enc = NULL, abha_hmac = NULL,
    abha_verified = false, identity_hmac = NULL, mrn = NULL, sex = 'unknown',
    oncosetu_token_hash = 'erased:' || id::text, token_revoked_at = coalesce(token_revoked_at, now()),
    status = 'erased', updated_at = now()
  WHERE id = ANY(v_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  c := c || jsonb_build_object('patients_tombstoned', n);

  UPDATE erasure_requests SET state = 'completed', completed_at = now() WHERE id = p_request_id;
  RETURN c;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION erase_patient(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erase_patient(uuid) TO oncosetu_app;
