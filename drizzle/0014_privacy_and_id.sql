-- DPDP notice acknowledgements (append-only: one row per acknowledgement, the latest per person is current) and the
-- optional ID verification record (ONLY the last 4 characters of an ID, masked; never a full Aadhaar number).
-- Draft, legal review pending. RLS forced on org_id, like 0001/0003.
CREATE TABLE "privacy_acknowledgements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" uuid NOT NULL,
  "notice_version" text NOT NULL,
  "language" text NOT NULL,
  "acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "privacy_ack_actor_ck" CHECK ("actor_type" IN ('patient', 'caregiver'))
);
--> statement-breakpoint
CREATE TABLE "id_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "id_type" text NOT NULL,
  "last4" text NOT NULL,
  "verified_by" uuid NOT NULL,
  "verified_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "id_verifications_type_ck" CHECK ("id_type" IN ('aadhaar', 'abha', 'pan', 'voter_id', 'passport', 'driving_licence')),
  CONSTRAINT "id_verifications_last4_ck" CHECK ("last4" ~ '^[0-9A-Z]{4}$')
);
--> statement-breakpoint
ALTER TABLE "privacy_acknowledgements" ADD CONSTRAINT "privacy_ack_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "privacy_acknowledgements" ADD CONSTRAINT "privacy_ack_patient_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id");--> statement-breakpoint
ALTER TABLE "id_verifications" ADD CONSTRAINT "id_verifications_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");--> statement-breakpoint
ALTER TABLE "id_verifications" ADD CONSTRAINT "id_verifications_patient_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id");--> statement-breakpoint
ALTER TABLE "id_verifications" ADD CONSTRAINT "id_verifications_staff_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."staff"("id");--> statement-breakpoint
CREATE INDEX "privacy_ack_patient_idx" ON "privacy_acknowledgements" ("patient_id", "acknowledged_at");--> statement-breakpoint
CREATE INDEX "id_verifications_patient_idx" ON "id_verifications" ("patient_id", "verified_at");--> statement-breakpoint
GRANT SELECT, INSERT ON "privacy_acknowledgements" TO oncosetu_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "id_verifications" TO oncosetu_app;--> statement-breakpoint
GRANT UPDATE ("revoked_at") ON "id_verifications" TO oncosetu_app;--> statement-breakpoint
ALTER TABLE "privacy_acknowledgements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "privacy_acknowledgements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "id_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "id_verifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "privacy_acknowledgements"
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY org_isolation ON "id_verifications"
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
-- J8: when a patient is erased (patients.status becomes 'erased', 0006), the masked ID record goes with it.
-- Acknowledgements stay, like consents: ids, notice version and time only, no personal data.
CREATE OR REPLACE FUNCTION erase_patient_id_records() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM id_verifications WHERE patient_id = NEW.id;
  IF to_regclass('public.upload_sessions') IS NOT NULL THEN DELETE FROM upload_sessions WHERE patient_id = NEW.id; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patients_erase_id_records AFTER UPDATE OF status ON patients
  FOR EACH ROW WHEN (NEW.status = 'erased' AND OLD.status IS DISTINCT FROM 'erased') EXECUTE FUNCTION erase_patient_id_records();
