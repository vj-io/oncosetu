-- Admin agent: FR-VER-04 second reviews (append-only) and §16.4 "which document types" for the measurement form.
-- Both tables: RLS forced on org_id, explicit least-privilege GRANT (no UPDATE/DELETE: append-only, like verifications).
CREATE TABLE "verification_qa_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "verification_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "reviewer_id" uuid NOT NULL,
  "outcome" text NOT NULL,
  "reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "verification_qa_reviews_outcome_ck" CHECK ("outcome" IN ('agree', 'disagree')),
  CONSTRAINT "verification_qa_reviews_verification_uq" UNIQUE ("verification_id")
);
--> statement-breakpoint
CREATE TABLE "measurement_form_doc_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "form_id" uuid NOT NULL,
  "doc_type" text NOT NULL,
  CONSTRAINT "measurement_form_doc_types_form_type_uq" UNIQUE ("form_id", "doc_type")
);
--> statement-breakpoint
ALTER TABLE "verification_qa_reviews" ADD CONSTRAINT "verification_qa_reviews_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "verification_qa_reviews" ADD CONSTRAINT "verification_qa_reviews_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id");--> statement-breakpoint
ALTER TABLE "verification_qa_reviews" ADD CONSTRAINT "verification_qa_reviews_verification_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id");--> statement-breakpoint
ALTER TABLE "verification_qa_reviews" ADD CONSTRAINT "verification_qa_reviews_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id");--> statement-breakpoint
ALTER TABLE "verification_qa_reviews" ADD CONSTRAINT "verification_qa_reviews_reviewer_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."staff"("id");--> statement-breakpoint
ALTER TABLE "measurement_form_doc_types" ADD CONSTRAINT "measurement_form_doc_types_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "measurement_form_doc_types" ADD CONSTRAINT "measurement_form_doc_types_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."measurement_forms"("id");--> statement-breakpoint
CREATE INDEX "verification_qa_reviews_org_idx" ON "verification_qa_reviews" ("org_id", "reviewed_at");--> statement-breakpoint
CREATE INDEX "measurement_form_doc_types_form_idx" ON "measurement_form_doc_types" ("form_id");--> statement-breakpoint
GRANT SELECT, INSERT ON "verification_qa_reviews", "measurement_form_doc_types" TO oncosetu_app;--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['verification_qa_reviews', 'measurement_form_doc_types'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) '
      'WITH CHECK (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
