-- Three more descriptive event types (mentor review, 5 Nov 2026): allergy statements, follow-up dates and lab result
-- rows, each quoted word for word from its document. Additive only; existing rows are untouched.
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'allergy_documented' BEFORE 'patient_statement';
--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'follow_up_documented' BEFORE 'patient_statement';
--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'lab_results_documented' BEFORE 'patient_statement';
