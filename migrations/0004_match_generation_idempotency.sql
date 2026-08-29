-- Reconcile legacy queue rows before enforcing the canonical identity.
ALTER TABLE "match_generation_jobs" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
UPDATE "match_generation_jobs"
SET "idempotency_key" = concat(
  'match-generation-v1:',
  "job_type", ':',
  CASE
    WHEN "target_user_id" IS NULL THEN 'TARGETLESS_SEED'
    WHEN "job_type" = 'BATCH_PROFILES' THEN 'BATCH_PROFILES'
    WHEN "job_type" = 'USER_PROFILE_UPDATE' THEN 'PROFILE_UPDATE'
    ELSE 'DIRECTED_MATCH'
  END, ':',
  "user_id", ':',
  COALESCE("target_user_id"::text, 'SEED'), ':',
  COALESCE("user_profile_version"::text, 'UNKNOWN'), ':',
  COALESCE("target_user_profile_version"::text, 'UNKNOWN'), ':0'
)
WHERE "idempotency_key" IS NULL;
--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "idempotency_key"
      ORDER BY
        CASE "status"
          WHEN 'COMPLETED' THEN 1
          WHEN 'PROCESSING' THEN 2
          WHEN 'RETRYING' THEN 3
          WHEN 'PENDING' THEN 4
          WHEN 'FAILED' THEN 5
          WHEN 'CANCELLED' THEN 6
          ELSE 7
        END,
        "created_at" ASC,
        "id" ASC
    ) AS duplicate_rank
  FROM "match_generation_jobs"
)
DELETE FROM "match_generation_jobs" AS jobs
USING ranked
WHERE jobs."id" = ranked."id"
  AND ranked.duplicate_rank > 1;
--> statement-breakpoint
ALTER TABLE "match_generation_jobs"
  ALTER COLUMN "idempotency_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "match_generation_jobs"
  ADD CONSTRAINT "match_generation_jobs_idempotency_key_unique"
  UNIQUE ("idempotency_key");
--> statement-breakpoint
ALTER TABLE "synergy_matches"
  ALTER COLUMN "description" DROP NOT NULL,
  ALTER COLUMN "score" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "synergy_matches" ADD COLUMN "score_evidence" text;
--> statement-breakpoint
ALTER TABLE "synergy_matches"
  ADD COLUMN "generation_job_key" text,
  ADD COLUMN "generation_error" text;
--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "user_id", "matched_user_id"
      ORDER BY
        CASE "generation_status"
          WHEN 'READY' THEN 1
          WHEN 'GENERATING' THEN 2
          WHEN 'PENDING' THEN 3
          WHEN 'FAILED' THEN 4
          ELSE 5
        END,
        "updated_at" DESC,
        "id" ASC
    ) AS duplicate_rank
  FROM "synergy_matches"
)
DELETE FROM "synergy_matches" AS matches
USING ranked
WHERE matches."id" = ranked."id"
  AND ranked.duplicate_rank > 1;
--> statement-breakpoint
ALTER TABLE "synergy_matches"
  ADD CONSTRAINT "synergy_matches_directed_pair_unique"
  UNIQUE ("user_id", "matched_user_id");