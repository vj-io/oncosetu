-- Long scanned PDFs: a reading survives a retry. documents.read_progress = { page, total } while a runner reads ("Reading
-- page 7 of 16"); document_read_cache = one OCR'd page, saved the moment it is read, so a retry resumes at the next page.
-- Working data only (cleared when the document finishes, fails or is reprocessed). RLS on org_id like every patient table;
-- deleting a document removes its cache rows, so erase_patient() is never blocked. documents is covered by the 0001 grants.
ALTER TABLE "documents" ADD COLUMN "read_progress" jsonb;--> statement-breakpoint
CREATE TABLE "document_read_cache" (
  "document_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "page_no" integer NOT NULL,
  "data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "document_read_cache_pk" PRIMARY KEY ("document_id", "page_no")
);--> statement-breakpoint
ALTER TABLE "document_read_cache" ADD CONSTRAINT "document_read_cache_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document_read_cache" ADD CONSTRAINT "document_read_cache_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "document_read_cache" ADD CONSTRAINT "document_read_cache_patient_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id");--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "document_read_cache" TO oncosetu_app;--> statement-breakpoint
GRANT UPDATE ("patient_id") ON "document_read_cache" TO oncosetu_app;--> statement-breakpoint
ALTER TABLE "document_read_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_read_cache" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "document_read_cache"
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
