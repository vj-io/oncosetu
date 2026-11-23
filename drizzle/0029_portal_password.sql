-- Patients and caregivers can sign in to the portal from home with their mobile number and a password they choose after
-- a first sign-in with a one-time code (from the front desk, or by SMS). Only a scrypt hash is kept. Five wrong passwords
-- lock that sign-in for 15 minutes (the same rule as staff). A code from the desk still works, so a forgotten password is
-- replaced by signing in with a code and choosing a new one.
ALTER TABLE "patients" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "password_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "password_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "password_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "caregivers" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "caregivers" ADD COLUMN "password_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "caregivers" ADD COLUMN "password_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "caregivers" ADD COLUMN "password_locked_until" timestamp with time zone;
