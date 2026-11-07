-- Mentor review, 7 Nov 2026. Six more quote-only event types for lines an oncologist looks for first: stage as written,
-- marker (IHC / receptor / MMR) result rows, margins, an imaging impression, addendum text and the regimen line.
-- Each holds a sentence or row copied word for word, attached to its document (staff-only). Additive only; existing rows are untouched.
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'stage_documented' BEFORE 'patient_statement';
--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'marker_results_documented' BEFORE 'patient_statement';
--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'margins_documented' BEFORE 'patient_statement';
--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'impression_documented' BEFORE 'patient_statement';
--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'addendum_documented' BEFORE 'patient_statement';
--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE IF NOT EXISTS 'regimen_documented' BEFORE 'patient_statement';
