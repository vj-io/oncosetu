-- Offline desk capture (FR-OFF-02, V05-E2E-01/02).
--   encounters.offline_created: a visit a records or clinician device opened offline with a client UUIDv7, accepted by
--     the server on sync. It is never the desk's identity-verified visit (FR-ID-02): assertPatientAccess ignores it.
--   voice_clips.encounter_id: the optional desk audio note of an encounter (kept, not transcribed). Covered by the 0018
--     RLS policy, grants and erase trigger; ON DELETE SET NULL so erase_patient() (0006) deleting encounters is never blocked.
--   upload_sessions.client_file_id / client_captured_at: a chunked upload from the offline queue keeps its idempotency key
--     and device time until the file is assembled, so a reloaded browser can resume it without a duplicate.
ALTER TABLE "encounters" ADD COLUMN "offline_created" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_clips" ADD COLUMN "encounter_id" uuid;--> statement-breakpoint
ALTER TABLE "voice_clips" ADD CONSTRAINT "voice_clips_encounter_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX "voice_clips_encounter_idx" ON "voice_clips" ("encounter_id");--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "client_file_id" text;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "client_captured_at" timestamp with time zone;
