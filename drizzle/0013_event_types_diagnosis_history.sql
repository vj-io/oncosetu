-- Mentor review, 6 Nov 2026. Two more descriptive event types: a document's own diagnosis and history sections,
-- quoted word for word and attached to that document (staff-only). Additive only; existing rows are untouched.
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'diagnosis_documented' BEFORE 'patient_statement';
--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'history_documented' BEFORE 'patient_statement';
--> statement-breakpoint
-- Hinglish (Hindi in Roman script) as a patient language for portal pages, share links and SMS; letters stay en/hi.
ALTER TYPE "public"."lang" ADD VALUE IF NOT EXISTS 'hinglish';
