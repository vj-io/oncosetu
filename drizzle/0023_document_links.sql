-- WP2 "All records": a scan and its written report, proposed from dates and header words and confirmed by a person.
-- A link joins two documents of one patient. kind 'scan_report': a_id is the scan, b_id its report. The system only ever
-- writes state 'proposed'; a clinician or records officer moves it to 'confirmed' or 'rejected' (who and when are kept).
-- Nothing here is read from an image. The rows hold ids, dates and a short reason code, never document text.
-- RLS on org_id like every patient table. Deleting a document removes its links (so erase_patient() is never blocked).
CREATE TABLE "document_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "kind" text NOT NULL DEFAULT 'scan_report',
  "a_id" uuid NOT NULL,
  "b_id" uuid NOT NULL,
  "state" text NOT NULL DEFAULT 'proposed',
  "reason" text,
  "proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  CONSTRAINT "document_links_kind_ck" CHECK ("kind" IN ('scan_report', 'prior')),
  CONSTRAINT "document_links_state_ck" CHECK ("state" IN ('proposed', 'confirmed', 'rejected')),
  CONSTRAINT "document_links_distinct_ck" CHECK ("a_id" <> "b_id")
);
--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_patient_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id");--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_a_fk" FOREIGN KEY ("a_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_b_fk" FOREIGN KEY ("b_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_pair_uq" ON "document_links" ("a_id", "b_id", "kind");--> statement-breakpoint
CREATE INDEX "document_links_patient_idx" ON "document_links" ("patient_id");--> statement-breakpoint
GRANT SELECT, INSERT ON "document_links" TO oncosetu_app;--> statement-breakpoint
GRANT UPDATE ("state", "decided_by", "decided_at") ON "document_links" TO oncosetu_app;--> statement-breakpoint
ALTER TABLE "document_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "document_links"
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
