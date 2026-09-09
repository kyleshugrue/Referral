ALTER TABLE "account_erasure_jobs"
  ADD COLUMN IF NOT EXISTS "max_attempts" integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "last_error_class" text,
  ADD COLUMN IF NOT EXISTS "last_error_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "claim_token" text,
  ADD COLUMN IF NOT EXISTS "firebase_deleted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "media_deleted_at" timestamp with time zone;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS account_erasure_jobs_lease_expiry_idx
  ON "account_erasure_jobs" (status, lease_expires_at);