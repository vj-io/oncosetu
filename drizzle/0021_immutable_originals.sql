-- FR-DOC-08: original files are immutable; derived artefacts (page text, page images) are versioned with the processor
-- name and version that made them. Reprocessing no longer deletes earlier page text or page images: it marks them
-- superseded (superseded_at) and adds the new version; readers take the current one (superseded_at IS NULL).
--   document_files  an original's bytes, hash, size, type, kind and document never change, it is never superseded,
--                   and it is deleted only by erase_patient() / abdm_erase() (transaction-local flag oncosetu.erasing,
--                   set inside those SECURITY DEFINER functions; the app role setting the flag itself opens nothing).
--                   Page images: same content rule; marking one superseded is the only change.
--   document_pages  the text, words and hash of a page version never change; marking it superseded is the only change.
-- patient_id may still change on both tables (an approved duplicate merge moves rows to the surviving patient).
-- Derived rows may still be deleted by the app (E-CON-02: consent withdrawn mid-run discards the run's outputs).
ALTER TABLE "document_files" ADD COLUMN "processor" text;--> statement-breakpoint
ALTER TABLE "document_files" ADD COLUMN "processor_version" text;--> statement-breakpoint
ALTER TABLE "document_files" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_pages" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_pages" DROP CONSTRAINT "document_pages_doc_page_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "document_pages_doc_page_uq" ON "document_pages" ("document_id", "page_no") WHERE "superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "document_pages_doc_idx" ON "document_pages" ("document_id");--> statement-breakpoint
-- The app may only mark a version superseded or move rows with a merge; the triggers below hold for every role.
REVOKE UPDATE ON "document_files", "document_pages" FROM oncosetu_app;--> statement-breakpoint
GRANT UPDATE ("superseded_at", "patient_id") ON "document_files", "document_pages" TO oncosetu_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_document_file() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.kind <> 'original' THEN RETURN OLD; END IF;
    IF current_setting('oncosetu.erasing', true) = 'on' AND current_user <> 'oncosetu_app' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'original files are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.bytes_enc IS DISTINCT FROM OLD.bytes_enc OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.size IS DISTINCT FROM OLD.size
     OR NEW.mime IS DISTINCT FROM OLD.mime OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.page_no IS DISTINCT FROM OLD.page_no OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.processor IS DISTINCT FROM OLD.processor OR NEW.processor_version IS DISTINCT FROM OLD.processor_version
     OR (OLD.kind = 'original' AND NEW.superseded_at IS NOT NULL)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'document_files content is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER document_files_immutable BEFORE UPDATE OR DELETE ON "document_files" FOR EACH ROW EXECUTE FUNCTION guard_document_file();--> statement-breakpoint
CREATE TRIGGER document_files_no_truncate BEFORE TRUNCATE ON "document_files" FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_document_page() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.text IS DISTINCT FROM OLD.text OR NEW.words IS DISTINCT FROM OLD.words OR NEW.text_hash IS DISTINCT FROM OLD.text_hash
     OR NEW.ocr_confidence IS DISTINCT FROM OLD.ocr_confidence OR NEW.low_confidence IS DISTINCT FROM OLD.low_confidence
     OR NEW.processor IS DISTINCT FROM OLD.processor OR NEW.processor_version IS DISTINCT FROM OLD.processor_version
     OR NEW.page_no IS DISTINCT FROM OLD.page_no OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'document_pages content is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER document_pages_immutable BEFORE UPDATE ON "document_pages" FOR EACH ROW EXECUTE FUNCTION guard_document_page();--> statement-breakpoint
-- abdm_erase (0009) deletes the originals of the documents a transfer created: it now sets the same flag erase_patient()
-- sets. Body unchanged otherwise.
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
  PERFORM set_config('oncosetu.erasing', 'on', true);
  FOREACH t IN ARRAY ARRAY['ai_runs', 'document_pages', 'document_files'] LOOP
    EXECUTE format('DELETE FROM %I WHERE document_id = ANY($1)', t) USING v_docs;
    GET DIAGNOSTICS n = ROW_COUNT;
    c := c || jsonb_build_object(t, n);
  END LOOP;
  PERFORM set_config('oncosetu.erasing', 'off', true);
  DELETE FROM documents WHERE id = ANY(v_docs);
  GET DIAGNOSTICS n = ROW_COUNT;
  c := c || jsonb_build_object('documents', n);

  UPDATE abdm_transfers SET state = 'ERASED' WHERE consent_request_id = r.id AND state = 'TRANSFERRED';
  UPDATE abdm_consent_requests SET state = CASE WHEN state = 'GRANTED' THEN 'EXPIRED' ELSE state END,
    erased_at = now(), updated_at = now() WHERE id = r.id;
  RETURN c;
END $$;
