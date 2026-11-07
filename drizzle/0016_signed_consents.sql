-- Signed consent forms: who signed (name, relationship), how (drawn or typed), the witness at the desk, the form version, the
-- purposes agreed and the stored PDF. DRAFT form, legal review pending. Append-only, RLS forced on org_id.
-- The PDF is also a document of the patient (documents + document_files). document_id is SET NULL on delete so that
-- erase_patient() (0006) is never blocked; the signer's name is blanked when the patient is erased (trigger below), the
-- rest (ids, version, time, purposes) stays like consents.
CREATE TABLE "signed_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "consent_id" uuid,
  "action" text NOT NULL,
  "form_version" text NOT NULL,
  "signer_name_enc" text,
  "signer_relation" text NOT NULL,
  "method" text NOT NULL,
  "witness_staff_id" uuid,
  "signed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "language" text NOT NULL,
  "purposes" jsonb NOT NULL,
  "document_id" uuid,
  CONSTRAINT "signed_consents_action_ck" CHECK ("action" IN ('grant', 'update', 'withdraw')),
  CONSTRAINT "signed_consents_relation_ck" CHECK ("signer_relation" IN ('self', 'guardian', 'caregiver')),
  CONSTRAINT "signed_consents_method_ck" CHECK ("method" IN ('drawn', 'typed'))
);
--> statement-breakpoint
ALTER TABLE "signed_consents" ADD CONSTRAINT "signed_consents_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "signed_consents" ADD CONSTRAINT "signed_consents_patient_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id");--> statement-breakpoint
ALTER TABLE "signed_consents" ADD CONSTRAINT "signed_consents_consent_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id");--> statement-breakpoint
ALTER TABLE "signed_consents" ADD CONSTRAINT "signed_consents_witness_fk" FOREIGN KEY ("witness_staff_id") REFERENCES "public"."staff"("id");--> statement-breakpoint
ALTER TABLE "signed_consents" ADD CONSTRAINT "signed_consents_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX "signed_consents_patient_idx" ON "signed_consents" ("patient_id", "signed_at");--> statement-breakpoint
GRANT SELECT, INSERT ON "signed_consents" TO oncosetu_app;--> statement-breakpoint
ALTER TABLE "signed_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signed_consents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "signed_consents"
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE OR REPLACE FUNCTION erase_signed_consent_names() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE signed_consents SET signer_name_enc = NULL, document_id = NULL WHERE patient_id = NEW.id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patients_erase_signed_consent_names AFTER UPDATE OF status ON patients
  FOR EACH ROW WHEN (NEW.status = 'erased' AND OLD.status IS DISTINCT FROM 'erased') EXECUTE FUNCTION erase_signed_consent_names();
