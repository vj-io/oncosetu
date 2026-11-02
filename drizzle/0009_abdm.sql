-- FR-ING-ABDM-01/02 (J6): ABDM HIU consent requests and transfers (src/server/abdm/**). Received FHIR bundles are ordinary
-- documents (intake_route 'abdm', mime application/fhir+json, encrypted in document_files) with events whose source_type is
-- external_structured and whose evidence carries fhir_resource_ref; nothing here duplicates them.
--   abdm_consent_requests  one HIU consent request: what was asked (HI types, date range, purpose), the consent manager's
--                          ids, the decision (state), and the artefact as granted with the patient's ABHA replaced by its
--                          blind index (artefact->>'patientHmac'). erase_at = the artefact's dataEraseAt (PRD §10.5).
--   abdm_transfers         one health-information request + data push. Key material is never stored: only SHA-256 hashes
--                          of the public keys and nonces exchanged (the HIU's private key lives in memory for the transfer).
--                          document_ids = the documents created from the decrypted bundles (what abdm_erase() removes).
CREATE TABLE "abdm_consent_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "patient_id" uuid NOT NULL REFERENCES "patients"("id"),
  "requested_by" uuid NOT NULL REFERENCES "staff"("id"),
  "hi_types" text[] NOT NULL CHECK (cardinality("hi_types") > 0),
  "date_from" date NOT NULL,
  "date_to" date NOT NULL,
  "purpose" text DEFAULT 'CAREMGT' NOT NULL,
  "state" text DEFAULT 'REQUESTED' NOT NULL CHECK ("state" IN ('REQUESTED', 'GRANTED', 'DENIED', 'EXPIRED', 'REVOKED')),
  "gateway_request_id" text,
  "consent_request_id" text,
  "artefact_id" text,
  "artefact" jsonb,
  "erase_at" timestamp with time zone NOT NULL,
  "decided_at" timestamp with time zone,
  "erased_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CHECK ("date_from" <= "date_to")
);
--> statement-breakpoint
CREATE INDEX "abdm_consent_requests_patient_idx" ON "abdm_consent_requests" ("patient_id", "created_at");
--> statement-breakpoint
CREATE INDEX "abdm_consent_requests_erase_idx" ON "abdm_consent_requests" ("org_id", "erase_at") WHERE "erased_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "abdm_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "patient_id" uuid NOT NULL REFERENCES "patients"("id"),
  "consent_request_id" uuid NOT NULL REFERENCES "abdm_consent_requests"("id"),
  "transaction_id" text,
  "hiu_key_sha256" text NOT NULL,
  "hiu_nonce_sha256" text NOT NULL,
  "hip_key_sha256" text,
  "hip_nonce_sha256" text,
  "state" text DEFAULT 'REQUESTED' NOT NULL CHECK ("state" IN ('REQUESTED', 'TRANSFERRED', 'FAILED', 'ERASED')),
  "failure" text,
  "entries_count" integer DEFAULT 0 NOT NULL,
  "document_ids" uuid[] DEFAULT '{}' NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "received_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "abdm_transfers_request_idx" ON "abdm_transfers" ("consent_request_id");
--> statement-breakpoint
-- Least privilege (0001 style): the app inserts and moves state; nothing is deleted except through abdm_erase().
GRANT SELECT, INSERT, UPDATE ON "abdm_consent_requests", "abdm_transfers" TO oncosetu_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['abdm_consent_requests', 'abdm_transfers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) '
      'WITH CHECK (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- PRD §10.5: ABDM-sourced data is deleted at the artefact's erase-at time, or when the patient revokes the artefact.
-- abdm_erase(request) deletes the documents the request's transfers created and everything derived from them (pages,
-- files, events of every version, evidence, verifications and their QA reviews, AI-run rows), in the caller's transaction.
-- Radar rows and record requests that pointed at them are unlinked (the caller re-runs the Radar, which drops the rows a
-- person never acted on). Sealed snapshots are immutable and keep what they sealed (the ledger shows the removal as errata).
-- Preconditions are enforced here, so no caller can skip one: same org (RLS setting), and state REVOKED or erase_at passed
-- (real time: a fast-forwarded demo clock never makes data deletable early). A second call is a no-op.
CREATE OR REPLACE FUNCTION abdm_erase(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org uuid := nullif(current_setting('app.org_id', true), '')::uuid;
  r abdm_consent_requests%ROWTYPE;
  v_docs uuid[];
  v_events uuid[];
  t text;
  n bigint;
  c jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO r FROM abdm_consent_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_org IS NULL OR r.org_id <> v_org THEN
    RAISE EXCEPTION 'abdm_request_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.erased_at IS NOT NULL THEN
    RETURN jsonb_build_object('already_erased', true);
  END IF;
  IF r.state <> 'REVOKED' AND r.erase_at > now() THEN
    RAISE EXCEPTION 'abdm_erase_not_due' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  SELECT coalesce(array_agg(DISTINCT d), '{}') INTO v_docs
    FROM abdm_transfers x, unnest(x.document_ids) d WHERE x.consent_request_id = r.id;
  v_docs := ARRAY(SELECT id FROM documents WHERE id = ANY(v_docs) AND org_id = r.org_id AND patient_id = r.patient_id);
  SELECT coalesce(array_agg(id), '{}') INTO v_events FROM events WHERE document_id = ANY(v_docs);

  UPDATE missing_records SET trigger_event_id = NULL WHERE trigger_event_id = ANY(v_events);
  UPDATE missing_records SET matched_document_id = NULL WHERE matched_document_id = ANY(v_docs);
  UPDATE missing_records SET proposed_document_id = NULL WHERE proposed_document_id = ANY(v_docs);
  UPDATE record_requests SET fulfilled_document_id = NULL WHERE fulfilled_document_id = ANY(v_docs);
  -- Children before parents (FK order). Table names are constants, never input.
  FOREACH t IN ARRAY ARRAY['verification_qa_reviews', 'verifications'] LOOP
    EXECUTE format('DELETE FROM %I WHERE event_id = ANY($1)', t) USING v_events;
    GET DIAGNOSTICS n = ROW_COUNT;
    c := c || jsonb_build_object(t, n);
  END LOOP;
  DELETE FROM evidence WHERE event_id = ANY(v_events) OR document_id = ANY(v_docs);
  GET DIAGNOSTICS n = ROW_COUNT;
  c := c || jsonb_build_object('evidence', n);
  DELETE FROM events WHERE id = ANY(v_events);
  GET DIAGNOSTICS n = ROW_COUNT;
  c := c || jsonb_build_object('events', n);
  FOREACH t IN ARRAY ARRAY['ai_runs', 'document_pages', 'document_files'] LOOP
    EXECUTE format('DELETE FROM %I WHERE document_id = ANY($1)', t) USING v_docs;
    GET DIAGNOSTICS n = ROW_COUNT;
    c := c || jsonb_build_object(t, n);
  END LOOP;
  DELETE FROM documents WHERE id = ANY(v_docs);
  GET DIAGNOSTICS n = ROW_COUNT;
  c := c || jsonb_build_object('documents', n);

  UPDATE abdm_transfers SET state = 'ERASED' WHERE consent_request_id = r.id AND state = 'TRANSFERRED';
  UPDATE abdm_consent_requests SET state = CASE WHEN state = 'GRANTED' THEN 'EXPIRED' ELSE state END,
    erased_at = now(), updated_at = now() WHERE id = r.id;
  RETURN c;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION abdm_erase(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION abdm_erase(uuid) TO oncosetu_app;
--> statement-breakpoint
-- Patient erasure (0006) keeps a tombstone and deletes from a fixed list; the ABDM rows (artefact metadata with the
-- ABHA blind index) go when the patient becomes `erased`, the way 0008 clears the inbound-channel tables.
CREATE OR REPLACE FUNCTION erase_abdm_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM abdm_transfers WHERE patient_id = NEW.id;
  DELETE FROM abdm_consent_requests WHERE patient_id = NEW.id;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION erase_abdm_rows() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER patients_erase_abdm AFTER UPDATE OF status ON patients
  FOR EACH ROW WHEN (NEW.status::text = 'erased' AND OLD.status::text <> 'erased') EXECUTE FUNCTION erase_abdm_rows();
