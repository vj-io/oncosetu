-- J8 / PRD §10.5: erasure requests queued after consent withdrawal. The app only inserts a request and (later) moves its
-- state; nothing is deleted here. eligible_after = max(requested_at + org retention days, last encounter + 3 years).
-- Least privilege: SELECT, INSERT, and UPDATE of state + completed_at only. RLS forced on org_id, like 0001.
CREATE TABLE "erasure_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "requested_by_kind" text NOT NULL,
  "requested_by_id" uuid NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "state" text DEFAULT 'queued' NOT NULL,
  "eligible_after" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "erasure_requests_state_ck" CHECK ("state" IN ('queued', 'scheduled', 'completed', 'cancelled')),
  CONSTRAINT "erasure_requests_by_kind_ck" CHECK ("requested_by_kind" IN ('patient', 'caregiver', 'staff'))
);
--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id");--> statement-breakpoint
CREATE INDEX "erasure_requests_org_idx" ON "erasure_requests" ("org_id", "requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "erasure_requests_open_uq" ON "erasure_requests" ("patient_id") WHERE "state" IN ('queued', 'scheduled');--> statement-breakpoint
GRANT SELECT, INSERT ON "erasure_requests" TO oncosetu_app;--> statement-breakpoint
GRANT UPDATE ("state", "completed_at") ON "erasure_requests" TO oncosetu_app;--> statement-breakpoint
ALTER TABLE "erasure_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "erasure_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "erasure_requests"
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
