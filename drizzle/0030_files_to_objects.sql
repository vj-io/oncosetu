-- Every stored file body goes to object storage when one is configured (src/server/files.ts sealFile): a free 1 GB database
-- held only about 3,500 page images. Until now only originals (0028) and upload chunks went there. Voice clips and held
-- inbound files get the same object_key column as document_files: set when the ciphertext lives in the bucket, bytes_enc
-- then empty; the row keeps the per-file key (dek_wrapped).
-- Files stored before this keep their bytes until scripts/move-files-to-objects.ts moves each one. For document_files that
-- move is the only change the 0021/0028 guard now lets through: bytes_enc emptied and object_key set in one update, every
-- other column unchanged (same ciphertext, same per-file key, same sha256), by the owner role with the transaction-local
-- flag oncosetu.moving_files on. The app role can never do it; everything else about a stored file stays immutable.
ALTER TABLE "voice_clips" ADD COLUMN "object_key" text;--> statement-breakpoint
ALTER TABLE "inbound_hold_files" ADD COLUMN "object_key" text;--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_document_file() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.kind <> 'original' THEN RETURN OLD; END IF;
    IF current_setting('oncosetu.erasing', true) = 'on' AND current_user <> 'oncosetu_app' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'original files are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.object_key IS NULL AND NEW.object_key IS NOT NULL
     AND current_setting('oncosetu.moving_files', true) = 'on' AND current_user <> 'oncosetu_app' THEN
    -- nested so that ordinary updates (superseding a page image) never build the JSON copies of the row
    IF octet_length(NEW.bytes_enc) = 0 AND (to_jsonb(NEW) - 'bytes_enc' - 'object_key') = (to_jsonb(OLD) - 'bytes_enc' - 'object_key') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.bytes_enc IS DISTINCT FROM OLD.bytes_enc OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.size IS DISTINCT FROM OLD.size
     OR NEW.mime IS DISTINCT FROM OLD.mime OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.page_no IS DISTINCT FROM OLD.page_no OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.processor IS DISTINCT FROM OLD.processor OR NEW.processor_version IS DISTINCT FROM OLD.processor_version
     OR NEW.object_key IS DISTINCT FROM OLD.object_key
     OR (OLD.kind = 'original' AND NEW.superseded_at IS NOT NULL)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'document_files content is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
