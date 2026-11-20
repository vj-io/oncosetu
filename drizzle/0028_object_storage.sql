-- Originals may live in S3-compatible object storage (Cloudflare R2) instead of bytes_enc, so a free 1 GB database can hold
-- many patients' imaging (src/server/objects.ts). The row keeps the per-file key (dek_wrapped), size and sha256; bytes_enc
-- is empty and object_key names the encrypted object. Deleting the row (erasure) leaves only ciphertext nobody can decrypt.
-- The key is as immutable as the bytes: the guard from 0021 now also refuses any change to object_key.
ALTER TABLE "document_files" ADD COLUMN "object_key" text;--> statement-breakpoint
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
     OR NEW.object_key IS DISTINCT FROM OLD.object_key
     OR (OLD.kind = 'original' AND NEW.superseded_at IS NOT NULL)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'document_files content is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
