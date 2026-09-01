ALTER TABLE callback_notification_queue
  ADD COLUMN IF NOT EXISTS dedupe_key text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS callback_notification_queue_dedupe_key_idx
  ON callback_notification_queue (dedupe_key)
  WHERE dedupe_key IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS delivery_obligations (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE cascade,
  event_type text NOT NULL,
  payload text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS delivery_obligations_pending_idx
  ON delivery_obligations (status, created_at);