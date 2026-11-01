CREATE TYPE "public"."actor_kind" AS ENUM('staff', 'patient', 'caregiver', 'system');--> statement-breakpoint
CREATE TYPE "public"."attach_state" AS ENUM('auto', 'pending_decision', 'attached', 'rejected', 'detached');--> statement-breakpoint
CREATE TYPE "public"."consent_action" AS ENUM('grant', 'update', 'withdraw');--> statement-breakpoint
CREATE TYPE "public"."date_precision" AS ENUM('day', 'month', 'year', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."disclosure_status" AS ENUM('cleared', 'not_cleared', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('queued', 'processing', 'done', 'needs_review', 'failed', 'quarantined', 'unreadable');--> statement-breakpoint
CREATE TYPE "public"."encounter_type" AS ENUM('onboarding', 'returning', 'between');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('document_received', 'procedure_documented', 'pathology_report_documented', 'molecular_test_documented', 'imaging_report_documented', 'lab_report_documented', 'prescription_documented', 'chemotherapy_session_documented', 'radiotherapy_documented', 'admission_documented', 'discharge_documented', 'consultation_documented', 'referral_documented', 'report_pending_documented', 'patient_statement');--> statement-breakpoint
CREATE TYPE "public"."extraction_method" AS ENUM('manual', 'text_layer', 'ocr_llm', 'structured_map', 'asr');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('original', 'page_image');--> statement-breakpoint
CREATE TYPE "public"."identity_result" AS ENUM('match', 'mismatch', 'insufficient', 'pending');--> statement-breakpoint
CREATE TYPE "public"."impact_rating" AS ENUM('none', 'delayed_decision', 'repeat_test_ordered', 'visit_rescheduled');--> statement-breakpoint
CREATE TYPE "public"."lang" AS ENUM('en', 'hi');--> statement-breakpoint
CREATE TYPE "public"."merge_state" AS ENUM('requested', 'approved', 'executed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."missing_state" AS ENUM('expected', 'requested', 'received', 'closed', 'unobtainable', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."outbox_channel" AS ENUM('sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."patient_status" AS ENUM('active', 'merged', 'erasure_requested', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."primary_contact" AS ENUM('patient', 'caregiver');--> statement-breakpoint
CREATE TYPE "public"."repeat_test_reason" AS ENUM('unavailable', 'quality', 'clinical_need');--> statement-breakpoint
CREATE TYPE "public"."request_state" AS ENUM('drafted', 'sent', 'reminder_due', 'open_21d', 'fulfilled', 'unobtainable', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."rule_mode" AS ENUM('production', 'shadow');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('staff', 'patient', 'caregiver');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('female', 'male', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."share_scope" AS ENUM('summary', 'summary_with_documents');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('patient_reported', 'caregiver_reported', 'external_document', 'internal_document', 'external_structured', 'clinician_entered');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('desk', 'records', 'clinician', 'org_admin', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."statement_confirmation" AS ENUM('pending', 'confirmed', 'corrected', 'declined');--> statement-breakpoint
CREATE TYPE "public"."study_phase" AS ENUM('baseline', 'shadow', 'live');--> statement-breakpoint
CREATE TYPE "public"."verification_action" AS ENUM('verify', 'edit', 'reject', 'dispute', 'resolve_conflict', 'reopen');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'verified_matches_source', 'edited', 'rejected', 'disputed');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid,
	"document_id" uuid,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"prompt_id" text,
	"prompt_version" text,
	"schema_version" text,
	"input_hash" text,
	"output_hash" text,
	"latency_ms" integer,
	"tokens_in" integer,
	"tokens_out" integer,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_id" uuid,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"request_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_log_org_seq_uq" UNIQUE("org_id","seq")
);
--> statement-breakpoint
CREATE TABLE "break_glass" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caregivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"name_enc" text NOT NULL,
	"relation" text NOT NULL,
	"phone_enc" text NOT NULL,
	"phone_hmac" text NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_guardian" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"action" "consent_action" NOT NULL,
	"purposes" jsonb NOT NULL,
	"actor_type" "actor_kind" NOT NULL,
	"actor_id" uuid,
	"method" text DEFAULT 'self' NOT NULL,
	"witnessed_by" uuid,
	"notice_version" text NOT NULL,
	"language" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"registered_by" uuid,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"wiped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" "file_kind" NOT NULL,
	"page_no" integer,
	"mime" text NOT NULL,
	"bytes_enc" "bytea" NOT NULL,
	"dek_wrapped" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"words" jsonb,
	"ocr_confidence" real,
	"low_confidence" boolean DEFAULT false NOT NULL,
	"processor" text,
	"processor_version" text,
	"text_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_pages_doc_page_uq" UNIQUE("document_id","page_no")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"client_file_id" text,
	"sha256" text NOT NULL,
	"phash" text,
	"near_dup_of" uuid,
	"duplicate_of" uuid,
	"mime" text NOT NULL,
	"pages" integer,
	"size_bytes" integer NOT NULL,
	"filename_enc" text,
	"intake_route" text NOT NULL,
	"uploaded_by_kind" "actor_kind" NOT NULL,
	"uploaded_by_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_captured_at" timestamp with time zone,
	"stage" text,
	"status" "doc_status" DEFAULT 'queued' NOT NULL,
	"locked_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"identity_result" "identity_result" DEFAULT 'pending' NOT NULL,
	"identity_details" jsonb,
	"attach_state" "attach_state" DEFAULT 'pending_decision' NOT NULL,
	"attach_decided_by" uuid,
	"attach_decided_at" timestamp with time zone,
	"attach_reason" text,
	"doc_type" text,
	"doc_type_confidence" real,
	"language" text,
	"handwritten" boolean,
	"quality" jsonb,
	"low_confidence" boolean DEFAULT false NOT NULL,
	"injection_flag" boolean DEFAULT false NOT NULL,
	"amendment_of" uuid,
	"document_date" date,
	"institution_name" text,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manual_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"processor" text,
	"processor_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"type" "encounter_type" NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_captured_at" timestamp with time zone,
	"sealed_snapshot_id" uuid,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"document_id" uuid,
	"event_type" "event_type" NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_date" date,
	"date_precision" date_precision DEFAULT 'unknown' NOT NULL,
	"date_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_date" date,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_type" "source_type" NOT NULL,
	"extraction_method" "extraction_method" NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conflict_group" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_by_kind" "actor_kind" DEFAULT 'system' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"document_id" uuid,
	"page_no" integer,
	"char_start" integer,
	"char_end" integer,
	"quote" text,
	"quote_sha256" text,
	"bbox" jsonb,
	"statement_id" uuid,
	"t_start" real,
	"t_end" real,
	"fhir_resource_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"encounter_id" uuid,
	"clinician_id" uuid NOT NULL,
	"consultation_date" date NOT NULL,
	"phase" "study_phase" NOT NULL,
	"first_visit" boolean DEFAULT true NOT NULL,
	"missing_record_present" boolean NOT NULL,
	"missing_record_count" integer DEFAULT 0 NOT NULL,
	"impact" "impact_rating" DEFAULT 'none' NOT NULL,
	"repeat_test_ordered" boolean DEFAULT false NOT NULL,
	"repeat_test_reason" "repeat_test_reason",
	"prep_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missing_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" text NOT NULL,
	"mode" "rule_mode" DEFAULT 'shadow' NOT NULL,
	"trigger_event_id" uuid,
	"expected_types" jsonb NOT NULL,
	"match_window" jsonb,
	"state" "missing_state" DEFAULT 'expected' NOT NULL,
	"matched_document_id" uuid,
	"proposed_document_id" uuid,
	"reason" text,
	"notes" text,
	"dedupe_key" text NOT NULL,
	"grouped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "missing_records_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"flags" jsonb DEFAULT '{"voice":false,"tts":false,"ai_extraction":false}'::jsonb NOT NULL,
	"demo_clock_offset_s" integer DEFAULT 0 NOT NULL,
	"retention_days" integer DEFAULT 3650 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'hospital' NOT NULL,
	"abdm_hfr_id" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_hmac" text NOT NULL,
	"purpose" text DEFAULT 'login' NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid,
	"channel" "outbox_channel" NOT NULL,
	"to_masked" text NOT NULL,
	"to_hmac" text NOT NULL,
	"template_key" text NOT NULL,
	"body" text NOT NULL,
	"lang" "lang" DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"name_enc" text NOT NULL,
	"name_hmac" text,
	"kind" text DEFAULT 'other' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"survivor_id" uuid NOT NULL,
	"duplicate_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"state" "merge_state" DEFAULT 'requested' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "patient_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"question_id" text NOT NULL,
	"audio_id" uuid,
	"answer" jsonb,
	"transcript" text,
	"language" text,
	"readback_text" text,
	"confirmation" "statement_confirmation" DEFAULT 'pending' NOT NULL,
	"asr_provider" text,
	"asr_model" text,
	"created_by_kind" "actor_kind" NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"oncosetu_token_hash" text NOT NULL,
	"token_revoked_at" timestamp with time zone,
	"mrn" text,
	"abha_number_enc" text,
	"abha_hmac" text,
	"abha_verified" boolean DEFAULT false NOT NULL,
	"name_enc" text NOT NULL,
	"dob_enc" text,
	"phone_enc" text,
	"phone_hmac" text,
	"identity_hmac" text,
	"sex" "sex" DEFAULT 'unknown' NOT NULL,
	"minor" boolean DEFAULT false NOT NULL,
	"deceased" boolean DEFAULT false NOT NULL,
	"disclosure_status" "disclosure_status" DEFAULT 'unknown' NOT NULL,
	"primary_contact" "primary_contact" DEFAULT 'patient' NOT NULL,
	"disclosure_set_by" uuid,
	"disclosure_set_at" timestamp with time zone,
	"preferred_language" "lang" DEFAULT 'en' NOT NULL,
	"status" "patient_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_oncosetu_token_hash_unique" UNIQUE("oncosetu_token_hash"),
	CONSTRAINT "patients_org_mrn_uq" UNIQUE("org_id","mrn")
);
--> statement-breakpoint
CREATE TABLE "record_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"missing_record_id" uuid,
	"institution" text NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"date_range" jsonb,
	"lang" "lang" DEFAULT 'en' NOT NULL,
	"letter_payload" jsonb,
	"state" "request_state" DEFAULT 'drafted' NOT NULL,
	"sent_at" timestamp with time zone,
	"reminder_7_sent_at" timestamp with time zone,
	"reminder_21_sent_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_document_id" uuid,
	"created_by_kind" "actor_kind" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_states" (
	"org_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"mode" "rule_mode" DEFAULT 'shadow' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "rule_states_org_id_rule_id_pk" PRIMARY KEY("org_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"kind" "session_kind" NOT NULL,
	"staff_id" uuid,
	"patient_id" uuid,
	"caregiver_id" uuid,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"idle_timeout_s" integer NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"scope" "share_scope" DEFAULT 'summary' NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"passcode_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_kind" "actor_kind" NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"share_link_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"outcome" text DEFAULT 'viewed' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"seq" integer NOT NULL,
	"canonical_json" text NOT NULL,
	"sha256" text NOT NULL,
	"signature" text,
	"key_id" text,
	"signer_id" uuid,
	"sealed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshots_patient_seq_uq" UNIQUE("patient_id","seq")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "staff_role" NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"action" "verification_action" NOT NULL,
	"from_status" "verification_status",
	"to_status" "verification_status" NOT NULL,
	"actor_kind" "actor_kind" DEFAULT 'staff' NOT NULL,
	"actor_id" uuid NOT NULL,
	"role" text NOT NULL,
	"reason" text,
	"viewed_source" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass" ADD CONSTRAINT "break_glass_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass" ADD CONSTRAINT "break_glass_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass" ADD CONSTRAINT "break_glass_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregivers" ADD CONSTRAINT "caregivers_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregivers" ADD CONSTRAINT "caregivers_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_witnessed_by_staff_id_fk" FOREIGN KEY ("witnessed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_registered_by_staff_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_statement_id_patient_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."patient_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_forms" ADD CONSTRAINT "measurement_forms_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_forms" ADD CONSTRAINT "measurement_forms_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_forms" ADD CONSTRAINT "measurement_forms_clinician_id_staff_id_fk" FOREIGN KEY ("clinician_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missing_records" ADD CONSTRAINT "missing_records_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missing_records" ADD CONSTRAINT "missing_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missing_records" ADD CONSTRAINT "missing_records_trigger_event_id_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missing_records" ADD CONSTRAINT "missing_records_matched_document_id_documents_id_fk" FOREIGN KEY ("matched_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missing_records" ADD CONSTRAINT "missing_records_proposed_document_id_documents_id_fk" FOREIGN KEY ("proposed_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_aliases" ADD CONSTRAINT "patient_aliases_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_aliases" ADD CONSTRAINT "patient_aliases_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_survivor_id_patients_id_fk" FOREIGN KEY ("survivor_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_duplicate_id_patients_id_fk" FOREIGN KEY ("duplicate_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_requested_by_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_statements" ADD CONSTRAINT "patient_statements_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_statements" ADD CONSTRAINT "patient_statements_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_statements" ADD CONSTRAINT "patient_statements_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_disclosure_set_by_staff_id_fk" FOREIGN KEY ("disclosure_set_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_requests" ADD CONSTRAINT "record_requests_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_requests" ADD CONSTRAINT "record_requests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_requests" ADD CONSTRAINT "record_requests_missing_record_id_missing_records_id_fk" FOREIGN KEY ("missing_record_id") REFERENCES "public"."missing_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_requests" ADD CONSTRAINT "record_requests_fulfilled_document_id_documents_id_fk" FOREIGN KEY ("fulfilled_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_states" ADD CONSTRAINT "rule_states_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_states" ADD CONSTRAINT "rule_states_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_views" ADD CONSTRAINT "share_views_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_views" ADD CONSTRAINT "share_views_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_views" ADD CONSTRAINT "share_views_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_doc_idx" ON "ai_runs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("org_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "break_glass_lookup_idx" ON "break_glass" USING btree ("patient_id","staff_id","expires_at");--> statement-breakpoint
CREATE INDEX "caregivers_patient_idx" ON "caregivers" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "caregivers_phone_idx" ON "caregivers" USING btree ("phone_hmac");--> statement-breakpoint
CREATE INDEX "consents_patient_idx" ON "consents" USING btree ("patient_id","recorded_at");--> statement-breakpoint
CREATE INDEX "document_files_doc_idx" ON "document_files" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_org_client_file_uq" ON "documents" USING btree ("org_id","client_file_id");--> statement-breakpoint
CREATE INDEX "documents_patient_idx" ON "documents" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "documents_patient_sha_idx" ON "documents" USING btree ("patient_id","sha256");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "encounters_patient_idx" ON "encounters" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "events_patient_idx" ON "events" USING btree ("patient_id","event_date");--> statement-breakpoint
CREATE INDEX "events_document_idx" ON "events" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "evidence_event_idx" ON "evidence" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "missing_records_patient_idx" ON "missing_records" USING btree ("patient_id","state");--> statement-breakpoint
CREATE INDEX "otp_phone_idx" ON "otp_challenges" USING btree ("phone_hmac","created_at");--> statement-breakpoint
CREATE INDEX "outbox_to_idx" ON "outbox" USING btree ("to_hmac","created_at");--> statement-breakpoint
CREATE INDEX "patient_aliases_patient_idx" ON "patient_aliases" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_statements_patient_idx" ON "patient_statements" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patients_org_idx" ON "patients" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "patients_phone_idx" ON "patients" USING btree ("phone_hmac");--> statement-breakpoint
CREATE INDEX "patients_abha_idx" ON "patients" USING btree ("abha_hmac");--> statement-breakpoint
CREATE INDEX "patients_identity_idx" ON "patients" USING btree ("identity_hmac");--> statement-breakpoint
CREATE INDEX "record_requests_patient_idx" ON "record_requests" USING btree ("patient_id","state");--> statement-breakpoint
CREATE INDEX "sessions_caregiver_idx" ON "sessions" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "share_links_patient_idx" ON "share_links" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "share_views_link_idx" ON "share_views" USING btree ("share_link_id");--> statement-breakpoint
CREATE INDEX "staff_org_idx" ON "staff" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "verifications_event_idx" ON "verifications" USING btree ("event_id");