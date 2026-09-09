ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "auth_epoch" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "refresh_tokens"
  ADD COLUMN IF NOT EXISTS "auth_session_id" text;
--> statement-breakpoint
ALTER TABLE "refresh_tokens"
  ADD COLUMN IF NOT EXISTS "revoked_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "refresh_tokens"
SET "auth_session_id" = md5("user_id"::text || ':' || "device_id" || ':' || "token_hash")
WHERE "auth_session_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "refresh_tokens"
  ALTER COLUMN "auth_session_id" SET NOT NULL;