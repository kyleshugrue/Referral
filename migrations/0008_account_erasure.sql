ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_completed_at timestamptz;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS account_erasure_jobs (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS account_erasure_jobs_user_id_idx
  ON account_erasure_jobs (user_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS account_erasure_jobs_status_attempt_idx
  ON account_erasure_jobs (status, next_attempt_at);