-- Chunked uploads: files over the 4.5 MB request limit arrive as chunks of at most 3.5 MB. Chunks are encrypted like every
-- stored file and deleted as soon as the finished file is assembled (or when the session is aborted or expires).
CREATE TABLE "upload_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "uploader_kind" text NOT NULL,
  "uploader_id" uuid NOT NULL,
  "file_name_enc" text,
  "total_size" bigint NOT NULL,
  "total_chunks" integer NOT NULL,
  "sha256" text NOT NULL,
  "intake_route" text NOT NULL,
  "encounter_id" uuid,
  "state" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "upload_sessions_state_ck" CHECK ("state" IN ('open', 'done', 'aborted')),
  CONSTRAINT "upload_sessions_kind_ck" CHECK ("uploader_kind" IN ('staff', 'patient', 'caregiver'))
);
--> statement-breakpoint
CREATE TABLE "upload_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "idx" integer NOT NULL,
  "bytes_enc" bytea NOT NULL,
  "dek_wrapped" text NOT NULL,
  "size" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_patient_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id");--> statement-breakpoint
ALTER TABLE "upload_chunks" ADD CONSTRAINT "upload_chunks_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "upload_chunks" ADD CONSTRAINT "upload_chunks_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "upload_chunks_session_idx_uq" ON "upload_chunks" ("session_id", "idx");--> statement-breakpoint
CREATE INDEX "upload_sessions_org_idx" ON "upload_sessions" ("org_id", "created_at");--> statement-breakpoint
GRANT SELECT, INSERT ON "upload_sessions" TO oncosetu_app;--> statement-breakpoint
GRANT UPDATE ("state") ON "upload_sessions" TO oncosetu_app;--> statement-breakpoint
GRANT DELETE ON "upload_sessions" TO oncosetu_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "upload_chunks" TO oncosetu_app;--> statement-breakpoint
GRANT UPDATE ("bytes_enc", "dek_wrapped", "size") ON "upload_chunks" TO oncosetu_app;--> statement-breakpoint
ALTER TABLE "upload_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "upload_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "upload_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "upload_chunks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "upload_sessions"
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY org_isolation ON "upload_chunks"
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
