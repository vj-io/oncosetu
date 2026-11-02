-- FR-ING-04 email drop and FR-ING-05 WhatsApp intake (src/server/inbound/**). documents.intake_route is plain text,
-- so the new values `email` and `whatsapp` need no DDL (the TS union lives in src/server/pipeline/ingest.ts).
--   contact_emails      addresses staff verified in person for a patient or one of its caregivers (encrypted + HMAC)
--   inbound_aliases     the per-patient drop address <alias_token>@INBOUND_EMAIL_DOMAIN (80-bit random base32)
--   inbound_holds       WhatsApp files waiting for the sender's one-time code (10 min, 5 attempts)
--   inbound_hold_files  the held files themselves, encrypted like document_files. A held file is NOT a document yet:
--                       it gets a documents row (ingestDocument) only when the code releases the hold, so it can never
--                       reach the record, Radar or the pipeline before that. document_ids lists what the release created.
CREATE TABLE "contact_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "patient_id" uuid NOT NULL REFERENCES "patients"("id"),
  -- CASCADE: erase_patient() (0006) deletes caregivers; their addresses go with them.
  "caregiver_id" uuid REFERENCES "caregivers"("id") ON DELETE CASCADE,
  "email_enc" text NOT NULL,
  "email_hmac" text NOT NULL,
  "verified_by" uuid NOT NULL REFERENCES "staff"("id"),
  "verified_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_emails_active_uq" ON "contact_emails" ("patient_id", "email_hmac") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "contact_emails_hmac_idx" ON "contact_emails" ("email_hmac");
--> statement-breakpoint
CREATE TABLE "inbound_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "patient_id" uuid NOT NULL REFERENCES "patients"("id"),
  "alias_token" text NOT NULL UNIQUE,
  "created_by" uuid REFERENCES "staff"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_aliases_active_uq" ON "inbound_aliases" ("patient_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "inbound_holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "patient_id" uuid NOT NULL REFERENCES "patients"("id"),
  "channel" text NOT NULL CHECK ("channel" IN ('whatsapp')),
  "sender_hmac" text NOT NULL,
  "document_ids" uuid[] DEFAULT '{}' NOT NULL,
  -- NULL only inside the transaction that creates the hold, until its code is issued.
  "code_hash" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "released_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One open hold per sender and patient: parallel webhooks (a forward of 5 photos = 5 requests) share it, one code.
CREATE UNIQUE INDEX "inbound_holds_open_uq" ON "inbound_holds" ("patient_id", "channel", "sender_hmac") WHERE "released_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "inbound_holds_expiry_idx" ON "inbound_holds" ("org_id", "expires_at") WHERE "released_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "inbound_hold_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "patient_id" uuid NOT NULL REFERENCES "patients"("id"),
  "hold_id" uuid NOT NULL REFERENCES "inbound_holds"("id") ON DELETE CASCADE,
  "mime" text NOT NULL,
  "bytes_enc" bytea NOT NULL,
  "dek_wrapped" text NOT NULL,
  "size" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "inbound_hold_files_hold_idx" ON "inbound_hold_files" ("hold_id");
--> statement-breakpoint
-- Least privilege (0001 style): addresses and aliases are never deleted by the app, only revoked.
GRANT SELECT, INSERT ON "contact_emails", "inbound_aliases" TO oncosetu_app;
--> statement-breakpoint
GRANT UPDATE ("revoked_at") ON "contact_emails", "inbound_aliases" TO oncosetu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "inbound_holds" TO oncosetu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "inbound_hold_files" TO oncosetu_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contact_emails', 'inbound_aliases', 'inbound_holds', 'inbound_hold_files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) '
      'WITH CHECK (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Public routing lookups for the webhooks (no session, so no org yet). Ids only, like resolve_patients_by_phone.
CREATE OR REPLACE FUNCTION resolve_inbound_alias(p_token text)
RETURNS TABLE (patient_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.patient_id, a.org_id FROM inbound_aliases a JOIN patients p ON p.id = a.patient_id
  WHERE a.alias_token = p_token AND a.revoked_at IS NULL AND p.status = 'active' AND NOT p.deceased
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_contact_email(p_email_hmac text)
RETURNS TABLE (contact_id uuid, patient_id uuid, org_id uuid, caregiver_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.patient_id, e.org_id, e.caregiver_id
  FROM contact_emails e JOIN patients p ON p.id = e.patient_id LEFT JOIN caregivers c ON c.id = e.caregiver_id
  WHERE e.email_hmac = p_email_hmac AND e.revoked_at IS NULL AND p.status = 'active'
    AND (e.caregiver_id IS NULL OR (c.active AND c.revoked_at IS NULL))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_inbound_alias(text), resolve_contact_email(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_inbound_alias(text), resolve_contact_email(text) TO oncosetu_app;
--> statement-breakpoint
-- Erasure (0006) keeps the patients row as a tombstone and deletes from a fixed table list. Rather than change that
-- function, the new tables are cleared when a patient becomes `erased`: addresses, aliases and held files are PII.
CREATE OR REPLACE FUNCTION erase_inbound_channels() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM inbound_holds WHERE patient_id = NEW.id; -- inbound_hold_files cascade
  DELETE FROM inbound_aliases WHERE patient_id = NEW.id;
  DELETE FROM contact_emails WHERE patient_id = NEW.id;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION erase_inbound_channels() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER patients_erase_inbound AFTER UPDATE OF status ON patients
  -- ::text: on a fresh database every migration runs in one transaction, where the enum value added by 0006 is not
  -- yet usable as an enum literal.
  FOR EACH ROW WHEN (NEW.status::text = 'erased' AND OLD.status::text <> 'erased') EXECUTE FUNCTION erase_inbound_channels();
