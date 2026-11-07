-- Voice answers kept beside their transcript (FR-VOX-05): each recording is encrypted like every stored file, belongs to
-- one patient, and is linked to the statement it became once the person confirms. Erased with the patient. RLS on org_id.
CREATE TABLE "voice_clips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "statement_id" uuid,
  "mime" text NOT NULL,
  "size" integer NOT NULL,
  "seconds" integer NOT NULL DEFAULT 0,
  "bytes_enc" bytea NOT NULL,
  "dek_wrapped" text NOT NULL,
  "asr_provider" text NOT NULL,
  "asr_model" text NOT NULL,
  "created_by_kind" text NOT NULL,
  "created_by_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "voice_clips_kind_ck" CHECK ("created_by_kind" IN ('patient', 'caregiver', 'staff'))
);
--> statement-breakpoint
ALTER TABLE "voice_clips" ADD CONSTRAINT "voice_clips_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "voice_clips" ADD CONSTRAINT "voice_clips_patient_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id");--> statement-breakpoint
CREATE INDEX "voice_clips_patient_idx" ON "voice_clips" ("patient_id", "created_at");--> statement-breakpoint
CREATE INDEX "voice_clips_statement_idx" ON "voice_clips" ("statement_id");--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "voice_clips" TO oncosetu_app;--> statement-breakpoint
GRANT UPDATE ("statement_id") ON "voice_clips" TO oncosetu_app;--> statement-breakpoint
ALTER TABLE "voice_clips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "voice_clips" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "voice_clips"
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE OR REPLACE FUNCTION erase_patient_voice_clips() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM voice_clips WHERE patient_id = NEW.id;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER patients_erase_voice_clips AFTER UPDATE OF status ON patients
  FOR EACH ROW WHEN (NEW.status = 'erased' AND OLD.status IS DISTINCT FROM 'erased') EXECUTE FUNCTION erase_patient_voice_clips();
