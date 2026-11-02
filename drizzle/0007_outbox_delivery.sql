-- Real SMS/WhatsApp delivery behind the outbox. The row stays the record in every case (masked number + HMAC, never the
-- number); these columns say what happened to the message after the request committed (src/server/outbox.ts):
--   simulated  no provider configured (demo, local dev); the default, which is also true of every existing row
--   queued     a provider is configured and delivery is pending
--   sent       accepted by the provider (provider_message_id holds its id); delivery receipts are not tracked
--   failed     refused or unreachable (delivery_error holds a short code, never the provider's message text)
CREATE TYPE "public"."outbox_delivery" AS ENUM('simulated', 'queued', 'sent', 'failed');
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "delivery" "outbox_delivery" DEFAULT 'simulated' NOT NULL;
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "provider_message_id" text;
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "delivery_error" text;
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "delivery_updated_at" timestamp with time zone;
--> statement-breakpoint
-- No new table, so RLS (0001, FORCE) already covers the new columns. Grants are repeated here on purpose: the app role
-- needs UPDATE on outbox for the delivery step and USAGE on the new type.
GRANT USAGE ON TYPE "public"."outbox_delivery" TO oncosetu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox" TO oncosetu_app;
