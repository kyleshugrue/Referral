CREATE TABLE rate_limit_windows (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits >= 0),
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint

CREATE INDEX rate_limit_windows_updated_at_idx
  ON rate_limit_windows (updated_at);