CREATE TABLE IF NOT EXISTS "websocket_tickets" (
  "id" serial PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "user_id" integer NOT NULL,
  "session_id" text,
  "audience" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "websocket_tickets_expiry_idx" ON "websocket_tickets" ("expires_at");