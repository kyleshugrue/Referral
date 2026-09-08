ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "read_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_receiver_delivery_idx"
  ON "messages" ("receiver_id", "delivered_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_receiver_read_idx"
  ON "messages" ("receiver_id", "read_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conversation_created_idx"
  ON "messages" ("conversation_id", "created_at", "id");