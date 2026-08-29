CREATE TABLE "callback_notification_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"notification_type" text NOT NULL,
	"payload" text NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "connection_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_id" integer NOT NULL,
	"receiver_id" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user1_id" integer NOT NULL,
	"user2_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user1_id" integer NOT NULL,
	"user2_id" integer NOT NULL,
	"is_group" boolean DEFAULT false,
	"group_member_ids" integer[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fcm_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_token" text NOT NULL,
	"platform" text DEFAULT 'ios-native' NOT NULL,
	"device_id" text,
	"device_model" text,
	"os_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fcm_tokens_device_token_unique" UNIQUE("device_token")
);
--> statement-breakpoint
CREATE TABLE "location_coordinates" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_name" text NOT NULL,
	"latitude" text NOT NULL,
	"longitude" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_coordinates_location_name_unique" UNIQUE("location_name")
);
--> statement-breakpoint
CREATE TABLE "match_generation_dead_letters" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_job_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"job_type" text NOT NULL,
	"metadata" text,
	"priority" integer NOT NULL,
	"failure_reason" text NOT NULL,
	"retry_history" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "match_generation_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"target_user_id" integer,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"metadata" text,
	"priority" integer DEFAULT 5 NOT NULL,
	"user_profile_version" integer,
	"target_user_profile_version" integer,
	"user_snapshot_id" integer,
	"target_user_snapshot_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"receiver_id" integer NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"related_id" integer NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "queued_push_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"payload" text NOT NULL,
	"priority" text DEFAULT 'standard' NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"device_id" text NOT NULL,
	"device_info" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "synergy_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"matched_user_id" integer NOT NULL,
	"description" text NOT NULL,
	"score" integer NOT NULL,
	"match_reasons" text[],
	"generation_status" text DEFAULT 'PENDING' NOT NULL,
	"last_profile_update" text,
	"template_used" text,
	"user_profile_version" integer,
	"matched_user_profile_version" integer,
	"api_calls_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"blocked_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profile_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"content_hash" text NOT NULL,
	"profile_data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"birthday" text,
	"title" text,
	"current_location" text,
	"current_location_lat" text,
	"current_location_lng" text,
	"firebase_uid" text,
	"desired_locations" text[],
	"desired_location_coords" text[],
	"industry" text,
	"current_company" text,
	"desired_companies" text[],
	"matching_radius" integer DEFAULT 0 NOT NULL,
	"years_of_experience" integer DEFAULT 0 NOT NULL,
	"bio" text,
	"photo" text DEFAULT '/placeholder.jpg' NOT NULL,
	"resume_url" text,
	"resume_preview_urls" text[],
	"interests" text[] DEFAULT '{}' NOT NULL,
	"professional_interests" text[] DEFAULT '{}' NOT NULL,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"education_level" text,
	"institution" text,
	"profile_visible" boolean DEFAULT true NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"read_receipts" boolean DEFAULT true NOT NULL,
	"email_verification_started" boolean DEFAULT false NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"registration_completed" boolean DEFAULT false NOT NULL,
	"has_minimum_match_data" boolean DEFAULT false NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"current_snapshot_id" integer,
	"initial_match_jobs_queued" boolean DEFAULT false NOT NULL,
	"initial_match_jobs_queued_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid")
);
--> statement-breakpoint
ALTER TABLE "callback_notification_queue" ADD CONSTRAINT "callback_notification_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user1_id_users_id_fk" FOREIGN KEY ("user1_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user2_id_users_id_fk" FOREIGN KEY ("user2_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user1_id_users_id_fk" FOREIGN KEY ("user1_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user2_id_users_id_fk" FOREIGN KEY ("user2_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fcm_tokens" ADD CONSTRAINT "fcm_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_generation_dead_letters" ADD CONSTRAINT "match_generation_dead_letters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_generation_jobs" ADD CONSTRAINT "match_generation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_generation_jobs" ADD CONSTRAINT "match_generation_jobs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_push_notifications" ADD CONSTRAINT "queued_push_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synergy_matches" ADD CONSTRAINT "synergy_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synergy_matches" ADD CONSTRAINT "synergy_matches_matched_user_id_users_id_fk" FOREIGN KEY ("matched_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_users_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_snapshots" ADD CONSTRAINT "user_profile_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_requests_sender_id_idx" ON "connection_requests" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "connection_requests_receiver_id_idx" ON "connection_requests" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "connections_user1_id_idx" ON "connections" USING btree ("user1_id");--> statement-breakpoint
CREATE INDEX "connections_user2_id_idx" ON "connections" USING btree ("user2_id");--> statement-breakpoint
CREATE INDEX "conversations_user1_id_idx" ON "conversations" USING btree ("user1_id");--> statement-breakpoint
CREATE INDEX "conversations_user2_id_idx" ON "conversations" USING btree ("user2_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_device_id_idx" ON "refresh_tokens" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "synergy_matches_user_id_idx" ON "synergy_matches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "synergy_matches_matched_user_id_idx" ON "synergy_matches" USING btree ("matched_user_id");--> statement-breakpoint
CREATE INDEX "idx_user_profile_snapshots_user_id_created_at" ON "user_profile_snapshots" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_user_profile_snapshots_content_hash" ON "user_profile_snapshots" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "firebase_uid_idx" ON "users" USING btree ("firebase_uid");