CREATE TABLE "refresh_token_reuse_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"action" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_token_reuse_events" ADD CONSTRAINT "refresh_token_reuse_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_token_reuse_events_user_id_idx" ON "refresh_token_reuse_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_token_reuse_events_detected_at_idx" ON "refresh_token_reuse_events" USING btree ("detected_at");