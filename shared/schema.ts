import { pgTable, text, serial, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";

// Shared, atomic abuse-control windows. The application writes this table
// through server/lib/postgres-rate-limit-store so request limits work across
// more than one application process.
export const rateLimitWindows = pgTable("rate_limit_windows", {
  key: text("key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: "string" }).notNull(),
  hits: integer("hits").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => ({
  updatedAtIdx: index("rate_limit_windows_updated_at_idx").on(table.updatedAt),
}));

export const educationLevels = [
  "High School",
  "Associate's Degree",
  "Bachelor's Degree",
  "Master's Degree",
  "Doctoral Degree",
  "Professional Degree",
  "Other"
] as const;

// Connection requests table for pending connections
export const connectionRequests = pgTable("connection_requests", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  receiverId: integer("receiver_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("requested"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
}, (table) => ({
  senderIdIdx: index("connection_requests_sender_id_idx").on(table.senderId),
  receiverIdIdx: index("connection_requests_receiver_id_idx").on(table.receiverId),
  pendingPairUniqueIdx: uniqueIndex("connection_requests_pending_pair_unique")
    .using(
      "btree",
      sql`LEAST(${table.senderId}, ${table.receiverId})`,
      sql`GREATEST(${table.senderId}, ${table.receiverId})`,
    )
    .where(sql`${table.status} = 'requested'`),
}));

// Connections table for accepted connections only
export const connections = pgTable("connections", {
  id: serial("id").primaryKey(),
  user1Id: integer("user1_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  user2Id: integer("user2_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
}, (table) => ({
  user1IdIdx: index("connections_user1_id_idx").on(table.user1Id),
  user2IdIdx: index("connections_user2_id_idx").on(table.user2Id),
  unorderedPairUniqueIdx: uniqueIndex("connections_unordered_pair_unique")
    .using(
      "btree",
      sql`LEAST(${table.user1Id}, ${table.user2Id})`,
      sql`GREATEST(${table.user1Id}, ${table.user2Id})`,
    ),
}));

// Location coordinates cache table
export const locationCoordinates = pgTable("location_coordinates", {
  id: serial("id").primaryKey(),
  locationName: text("location_name").notNull().unique(),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  lastUsed: timestamp("last_used", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  birthday: text("birthday"),
  title: text("title"),
  currentLocation: text("current_location"),
  currentLocationLat: text("current_location_lat"),
  currentLocationLng: text("current_location_lng"),
  firebaseUid: text("firebase_uid").unique(),
  desiredLocations: text("desired_locations").array(),
  desiredLocationCoords: text("desired_location_coords").array(), // JSON strings of {lat, lng, location}
  industry: text("industry"),
  currentCompany: text("current_company"),
  desiredCompanies: text("desired_companies").array(),
  matchingRadius: integer("matching_radius").notNull().default(0),
  yearsOfExperience: integer("years_of_experience").notNull().default(0),
  bio: text("bio"),
  photo: text("photo").notNull().default("/placeholder.jpg"),
  resumeUrl: text("resume_url"),
  resumePreviewUrls: text("resume_preview_urls").array(),
  interests: text("interests").array().notNull().default([]),
  professionalInterests: text("professional_interests").array().notNull().default([]),
  languages: text("languages").array().notNull().default([]),
  educationLevel: text("education_level"),
  institution: text("institution"),
  profileVisible: boolean("profile_visible").notNull().default(true),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  readReceipts: boolean("read_receipts").notNull().default(true),
  // Simple binary authentication system (device-agnostic)
  emailVerificationStarted: boolean("email_verification_started").notNull().default(false),
  emailVerified: boolean("email_verified").notNull().default(false),
  registrationCompleted: boolean("registration_completed").notNull().default(false),
  // Minimum data tracking for AI match processing (separate from registration completion)
  hasMinimumMatchData: boolean("has_minimum_match_data").notNull().default(false),
  // Profile version for staleness detection
  profileVersion: integer("profile_version").notNull().default(1),
  // Current snapshot pointer for rollback-proof job processing
  currentSnapshotId: integer("current_snapshot_id"),
  // Initial match job queueing tracking (prevents duplicate job creation)
  initialMatchJobsQueued: boolean("initial_match_jobs_queued").notNull().default(false),
  initialMatchJobsQueuedAt: timestamp("initial_match_jobs_queued_at", { withTimezone: true, mode: "string" }),
}, (table) => ({
  firebaseUidIdx: index("firebase_uid_idx").on(table.firebaseUid),
}));

// Immutable profile snapshots for rollback-proof job processing
export const userProfileSnapshots = pgTable("user_profile_snapshots", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(),
  profileData: text("profile_data").notNull(), // JSONB stored as text
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
}, (table) => ({
  userIdCreatedAtIdx: index("idx_user_profile_snapshots_user_id_created_at").on(table.userId, table.createdAt),
  contentHashIdx: index("idx_user_profile_snapshots_content_hash").on(table.contentHash),
}));

export const locationCoordinatesRelations = relations(locationCoordinates, () => ({}));

export const usersRelations = relations(users, ({ many }) => ({
  sentRequests: many(connectionRequests),
  receivedRequests: many(connectionRequests),
  connections1: many(connections),
  connections2: many(connections),
  blockedUsers: many(userBlocks, { relationName: "user" }),
  blockedByUsers: many(userBlocks, { relationName: "blockedUser" })
}));

export const connectionRequestsRelations = relations(connectionRequests, ({ one }) => ({
  sender: one(users),
  receiver: one(users)
}));

export const connectionsRelations = relations(connections, ({ one }) => ({
  user1: one(users),
  user2: one(users)
}));

// Conversations table to track message history between users
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  user1Id: integer("user1_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  user2Id: integer("user2_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  isGroup: boolean("is_group").default(false),
  groupMemberIds: integer("group_member_ids").array(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
}, (table) => ({
  user1IdIdx: index("conversations_user1_id_idx").on(table.user1Id),
  user2IdIdx: index("conversations_user2_id_idx").on(table.user2Id),
  directPairUniqueIdx: uniqueIndex("conversations_direct_pair_unique")
    .using(
      "btree",
      sql`LEAST(${table.user1Id}, ${table.user2Id})`,
      sql`GREATEST(${table.user1Id}, ${table.user2Id})`,
    )
    .where(sql`COALESCE(${table.isGroup}, false) = false`),
}));

// Update messages table to include conversation_id
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  senderId: integer("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  receiverId: integer("receiver_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
}, (table) => ({
  conversationIdIdx: index("messages_conversation_id_idx").on(table.conversationId),
}));

// Update relations
export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user1: one(users, {
    fields: [conversations.user1Id],
    references: [users.id],
  }),
  user2: one(users, {
    fields: [conversations.user2Id],
    references: [users.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
  }),
  receiver: one(users, {
    fields: [messages.receiverId],
    references: [users.id],
  }),
}));

// Canonical job status values for the match generation queue.
// Active statuses: PENDING, PROCESSING, RETRYING. Terminal: COMPLETED, FAILED, CANCELLED.
export const JOB_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "RETRYING", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// Background job queue for match generation
export const matchGenerationJobs = pgTable("match_generation_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  targetUserId: integer("target_user_id")
    .references(() => users.id, { onDelete: "cascade" }),
  jobType: text("job_type").notNull(), // MATCH_DESCRIPTION, BATCH_PROFILES, USER_PROFILE_UPDATE
  status: text("status").notNull().default("PENDING"), // See JOB_STATUSES: PENDING, PROCESSING, COMPLETED, FAILED, RETRYING, CANCELLED
  metadata: text("metadata"), // JSON with job-specific data including profileVersions and matchReasons
  priority: integer("priority").notNull().default(5), // 1=highest, 10=lowest
  userProfileVersion: integer("user_profile_version"),
  targetUserProfileVersion: integer("target_user_profile_version"),
  idempotencyKey: text("idempotency_key").notNull(),
  // Snapshot IDs for rollback-proof job processing
  userSnapshotId: integer("user_snapshot_id"),
  targetUserSnapshotId: integer("target_user_snapshot_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
});

// Dead letter queue for permanently failed match generation jobs
export const matchGenerationDeadLetters = pgTable("match_generation_dead_letters", {
  id: serial("id").primaryKey(),
  originalJobId: integer("original_job_id").notNull(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  jobType: text("job_type").notNull(),
  metadata: text("metadata"),
  priority: integer("priority").notNull(),
  failureReason: text("failure_reason").notNull(),
  retryHistory: text("retry_history").notNull(),
  failedAt: timestamp("failed_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "string" }),
});

// Synergy matches table to store AI-generated matches and their descriptions
export const synergyMatches = pgTable("synergy_matches", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  matchedUserId: integer("matched_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  description: text("description"),
  score: integer("score"),
  matchReasons: text("match_reasons").array(),
  scoreEvidence: text("score_evidence"),
  generationStatus: text("generation_status").notNull().default("PENDING"), // PENDING, GENERATING, READY, FAILED
  lastProfileUpdate: text("last_profile_update"), // Track when profiles were last updated
  templateUsed: text("template_used"), // Track which template was used
  userProfileVersion: integer("user_profile_version"), // Profile version when this match was generated
  matchedUserProfileVersion: integer("matched_user_profile_version"), // Target user's profile version when this match was generated
  generationJobKey: text("generation_job_key"),
  generationError: text("generation_error"),
  apiCallsUsed: integer("api_calls_used").notNull().default(0), // Track API usage
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
}, (table) => ({
  userIdIdx: index("synergy_matches_user_id_idx").on(table.userId),
  matchedUserIdIdx: index("synergy_matches_matched_user_id_idx").on(table.matchedUserId),
  directedPairUnique: uniqueIndex("synergy_matches_directed_pair_unique")
    .on(table.userId, table.matchedUserId),
}));

// User blocks table to store blocked user relationships
export const userBlocks = pgTable("user_blocks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  blockedUserId: integer("blocked_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
}, (table) => ({
  directedPairUniqueIdx: uniqueIndex("user_blocks_directed_pair_unique")
    .on(table.userId, table.blockedUserId),
}));

export const userBlocksRelations = relations(userBlocks, ({ one }) => ({
  user: one(users, {
    fields: [userBlocks.userId],
    references: [users.id],
  }),
  blockedUser: one(users, {
    fields: [userBlocks.blockedUserId],
    references: [users.id],
  }),
}));

export const matchGenerationJobsRelations = relations(matchGenerationJobs, ({ one }) => ({
  user: one(users, {
    fields: [matchGenerationJobs.userId],
    references: [users.id],
  }),
}));

export const matchGenerationDeadLettersRelations = relations(matchGenerationDeadLetters, ({ one }) => ({
  user: one(users, {
    fields: [matchGenerationDeadLetters.userId],
    references: [users.id],
  }),
}));

export const synergyMatchesRelations = relations(synergyMatches, ({ one }) => ({
  user: one(users, {
    fields: [synergyMatches.userId],
    references: [users.id],
  }),
  matchedUser: one(users, {
    fields: [synergyMatches.matchedUserId],
    references: [users.id],
  }),
}));

// Notifications table to track unread messages, connection requests, and new connections
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "message", "connection_request", "new_connection"
  relatedId: integer("related_id").notNull(), // ID of the message, connection request, or connection
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users)
  .omit({ id: true })
  .extend({
    email: z.string().email("Please enter a valid email address"),
    fullName: z.string().min(1, "Full name is required"),
    birthday: z.string().optional(),
    title: z.string().optional(),
    currentLocation: z.string().optional(),
    desiredLocations: z.array(z.string()).optional(),
    industry: z.string().optional(),
    currentCompany: z.string().optional(),
    desiredCompanies: z.array(z.string()).optional(),
    matchingRadius: z.coerce.number().int().min(0).max(100).default(0),
    yearsOfExperience: z.coerce.number().int().min(0, "Years of experience must be a non-negative number"),
    bio: z.string().optional(),
    photo: z.string().optional(),
    resumeUrl: z.string().optional(),
    resumePreviewUrls: z.array(z.string()).optional(),
    interests: z.array(z.string()).default([]),
    professionalInterests: z.array(z.string()).default([]),
    languages: z.array(z.string()).default([]),
    educationLevel: z.enum(educationLevels).optional(),
    institution: z.string().optional(),
    profileVisible: z.boolean().default(true),
    emailNotifications: z.boolean().default(true),
    readReceipts: z.boolean().default(true),
  });

// Fields a signed-in user may edit through profile endpoints. Keep this
// allowlist separate from insertUserSchema: authentication, identity,
// derived matching state, and server-maintained caches must never be accepted
// from an HTTP profile update. Completion is a one-way, server-validated claim
// used by the registration flow and is handled separately below.
export const editableProfileSchema = insertUserSchema.pick({
  fullName: true,
  birthday: true,
  title: true,
  currentLocation: true,
  desiredLocations: true,
  industry: true,
  currentCompany: true,
  desiredCompanies: true,
  matchingRadius: true,
  yearsOfExperience: true,
  bio: true,
  photo: true,
  resumeUrl: true,
  resumePreviewUrls: true,
  interests: true,
  professionalInterests: true,
  languages: true,
  educationLevel: true,
  institution: true,
  profileVisible: true,
  emailNotifications: true,
  readReceipts: true,
}).partial().extend({
  registrationCompleted: z.boolean().optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type EditableProfile = z.infer<typeof editableProfileSchema>;
export type User = typeof users.$inferSelect;
export type UserProfileSnapshot = typeof userProfileSnapshots.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type ConnectionRequest = typeof connectionRequests.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type SynergyMatch = typeof synergyMatches.$inferSelect;
export type MatchGenerationJob = typeof matchGenerationJobs.$inferSelect;
export type MatchGenerationDeadLetter = typeof matchGenerationDeadLetters.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type UserBlock = typeof userBlocks.$inferSelect;

export type Match = {
  id: number;
  userId: number;
  matchedUser: User;
  matchedAt: string;
  status: 'pending' | 'accepted' | 'rejected';
};

export const industries = [
  "Technology",
  "Finance",
  "Accounting",
  "Healthcare",
  "Marketing",
  "Sales",
  "Engineering",
  "Human Resources",
  "Operations",
  "Legal",
  "Design",
] as const;

export const insertMessageSchema = createInsertSchema(messages)
  .omit({ id: true })
  .extend({
    conversationId: z.number(),
    senderId: z.number(),
    receiverId: z.number(),
    content: z.string(),
    createdAt: z.string()
  });

export const insertMatchGenerationJobSchema = createInsertSchema(matchGenerationJobs)
  .omit({ id: true })
  .extend({
    userId: z.number(),
    jobType: z.enum(["MATCH_DESCRIPTION", "BATCH_PROFILES", "USER_PROFILE_UPDATE"]),
    status: z.enum(JOB_STATUSES).default("PENDING"),
    metadata: z.string().optional(),
    priority: z.number().min(1).max(10).default(5),
    createdAt: z.string().default(new Date().toISOString()),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    errorMessage: z.string().optional(),
    retryCount: z.number().default(0),
    maxRetries: z.number().default(3)
  });

export const insertMatchGenerationDeadLetterSchema = createInsertSchema(matchGenerationDeadLetters)
  .omit({ id: true })
  .extend({
    originalJobId: z.number(),
    userId: z.number(),
    jobType: z.string(),
    metadata: z.string().optional(),
    priority: z.number(),
    failureReason: z.string(),
    retryHistory: z.string(),
    failedAt: z.string().default(new Date().toISOString()),
    createdAt: z.string(),
    lastAttemptAt: z.string().optional()
  });

export const insertSynergyMatchSchema = createInsertSchema(synergyMatches)
  .omit({ id: true })
  .extend({
    userId: z.number(),
    matchedUserId: z.number(),
    description: z.string().nullable().optional(),
    score: z.number().nullable().optional(),
    matchReasons: z.array(z.string()).optional(),
    scoreEvidence: z.string().nullable().optional(),
    generationStatus: z.enum(["PENDING", "GENERATING", "READY", "FAILED"]).default("PENDING"),
    lastProfileUpdate: z.string().optional(),
    templateUsed: z.string().optional(),
    generationJobKey: z.string().nullable().optional(),
    generationError: z.string().nullable().optional(),
    apiCallsUsed: z.number().default(0),
    createdAt: z.string(),
    updatedAt: z.string()
  });

export const insertNotificationSchema = createInsertSchema(notifications)
  .omit({ id: true })
  .extend({
    userId: z.number(),
    type: z.enum(["message", "connection_request", "new_connection"]),
    relatedId: z.number(),
    read: z.boolean().default(false),
    createdAt: z.string().default(new Date().toISOString())
  });

export const insertUserBlockSchema = createInsertSchema(userBlocks)
  .omit({ id: true })
  .extend({
    userId: z.number(),
    blockedUserId: z.number(),
    createdAt: z.string().default(new Date().toISOString())
  });

// The email verification tokens functionality has been removed in favor of Firebase authentication

// Password reset tokens table to handle password resets
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  used: boolean("used").notNull().default(false),
});

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, {
    fields: [passwordResetTokens.email],
    references: [users.email],
  }),
}));

// Email verification token schema has been removed in favor of Firebase authentication

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens)
  .omit({ id: true })
  .extend({
    email: z.string().email("Please enter a valid email address"),
    token: z.string(),
    createdAt: z.string().default(new Date().toISOString()),
    expiresAt: z.string(),
    used: z.boolean().default(false)
  });

// FCM tokens table for iOS native push notifications with multi-device support
export const fcmTokens = pgTable("fcm_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceToken: text("device_token").notNull().unique(),
  platform: text("platform").notNull().default("ios-native"),
  deviceId: text("device_id"), // Unique device identifier (UUID from iOS)
  deviceModel: text("device_model"), // e.g., "iPhone 15 Pro"
  osVersion: text("os_version"), // e.g., "iOS 17.1"
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  lastUsed: timestamp("last_used", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
});

export const fcmTokensRelations = relations(fcmTokens, ({ one }) => ({
  user: one(users, {
    fields: [fcmTokens.userId],
    references: [users.id],
  }),
}));

// Queued push notifications for fallback when APNs is down
export const queuedPushNotifications = pgTable("queued_push_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  payload: text("payload").notNull(), // JSON string of PushNotificationData
  priority: text("priority").notNull().default("standard"), // 'critical' or 'standard'
  enqueuedAt: timestamp("enqueued_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(), // Calculated based on priority
  attemptCount: integer("attempt_count").notNull().default(0),
  status: text("status").notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed'
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "string" }),
  errorMessage: text("error_message"),
});

export const queuedPushNotificationsRelations = relations(queuedPushNotifications, ({ one }) => ({
  user: one(users, {
    fields: [queuedPushNotifications.userId],
    references: [users.id],
  }),
}));

// Callback notification queue for failed WebSocket callbacks
export const callbackNotificationQueue = pgTable("callback_notification_queue", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  notificationType: text("notification_type").notNull(), // 'matchRefresh', 'connectionRequest', etc.
  payload: text("payload").notNull(), // JSON string with notification data
  priority: integer("priority").notNull().default(5), // 1=highest, 10=lowest
  enqueuedAt: timestamp("enqueued_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(), // Notifications expire after a certain time
  attemptCount: integer("attempt_count").notNull().default(0),
  status: text("status").notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed'
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "string" }),
  errorMessage: text("error_message"),
  dedupeKey: text("dedupe_key").unique(),
});

export const callbackNotificationQueueRelations = relations(callbackNotificationQueue, ({ one }) => ({
  user: one(users, {
    fields: [callbackNotificationQueue.userId],
    references: [users.id],
  }),
}));

// Transactional delivery obligations bridge committed business mutations to
// asynchronous WebSocket/push/callback delivery. A unique dedupe key makes
// crash recovery idempotent when dispatch and acknowledgement are separated.
export const deliveryObligations = pgTable("delivery_obligations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'completed', 'expired'
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
});

export const deliveryObligationsRelations = relations(deliveryObligations, ({ one }) => ({
  user: one(users, {
    fields: [deliveryObligations.userId],
    references: [users.id],
  }),
}));

// Refresh tokens for JWT authentication (device-bound, rotating tokens)
export const refreshTokens = pgTable("refresh_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 hash of the refresh token
  deviceId: text("device_id").notNull(), // Unique device identifier
  deviceInfo: text("device_info").notNull(), // JSON string with IP, user-agent, platform info
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
}, (table) => ({
  userIdDeviceIdIdx: index("refresh_tokens_user_id_device_id_idx").on(table.userId, table.deviceId),
  tokenHashIdx: index("refresh_tokens_token_hash_idx").on(table.tokenHash),
  expiresAtIdx: index("refresh_tokens_expires_at_idx").on(table.expiresAt), // For cleanup queries
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

// Refresh token reuse events for security audit trail (anti-replay detection)
export const refreshTokenReuseEvents = pgTable("refresh_token_reuse_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull(),
  tokenHash: text("token_hash").notNull(), // Hash of the reused token
  detectedAt: timestamp("detected_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`),
  ipAddress: text("ip_address"), // Optional IP address where reuse was detected
  userAgent: text("user_agent"), // Optional user agent
  action: text("action").notNull(), // Action taken: 'logged', 'revoked_family', 'alert_sent'
}, (table) => ({
  userIdIdx: index("refresh_token_reuse_events_user_id_idx").on(table.userId),
  detectedAtIdx: index("refresh_token_reuse_events_detected_at_idx").on(table.detectedAt),
}));

export const refreshTokenReuseEventsRelations = relations(refreshTokenReuseEvents, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokenReuseEvents.userId],
    references: [users.id],
  }),
}));

export const insertFcmTokenSchema = createInsertSchema(fcmTokens)
  .omit({ id: true })
  .extend({
    userId: z.number(),
    deviceToken: z.string().min(1, "Device token is required"),
    platform: z.string().default("ios-native"),
    deviceId: z.string().optional(), // Optional device UUID
    deviceModel: z.string().optional(), // Optional device model
    osVersion: z.string().optional(), // Optional OS version
    createdAt: z.string().default(new Date().toISOString()),
    lastUsed: z.string().default(new Date().toISOString())
  });

export const insertCallbackNotificationSchema = createInsertSchema(callbackNotificationQueue)
  .omit({ id: true })
  .extend({
    userId: z.number(),
    notificationType: z.string().min(1),
    payload: z.string().min(1),
    priority: z.number().min(1).max(10).default(5),
    enqueuedAt: z.string().default(new Date().toISOString()),
    expiresAt: z.string(),
    attemptCount: z.number().default(0),
    status: z.enum(["pending", "processing", "completed", "failed"]).default("pending"),
    lastAttemptAt: z.string().optional(),
    errorMessage: z.string().optional()
  });

export const insertRefreshTokenSchema = createInsertSchema(refreshTokens)
  .omit({ id: true, createdAt: true, lastUsedAt: true })
  .extend({
    userId: z.number(),
    tokenHash: z.string().min(1),
    deviceId: z.string().min(1),
    deviceInfo: z.string().min(1), // JSON string
    expiresAt: z.string()
  });

export const insertRefreshTokenReuseEventSchema = createInsertSchema(refreshTokenReuseEvents)
  .omit({ id: true })
  .extend({
    userId: z.number(),
    deviceId: z.string().min(1),
    tokenHash: z.string().min(1),
    detectedAt: z.string().default(new Date().toISOString()),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    action: z.enum(['logged', 'revoked_family', 'alert_sent']).default('logged')
  });

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type InsertMatchGenerationJob = z.infer<typeof insertMatchGenerationJobSchema>;
export type InsertMatchGenerationDeadLetter = z.infer<typeof insertMatchGenerationDeadLetterSchema>;
export type InsertSynergyMatch = z.infer<typeof insertSynergyMatchSchema>;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type InsertUserBlock = z.infer<typeof insertUserBlockSchema>;
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type InsertFcmToken = z.infer<typeof insertFcmTokenSchema>;
export type InsertCallbackNotification = z.infer<typeof insertCallbackNotificationSchema>;
export type InsertRefreshToken = z.infer<typeof insertRefreshTokenSchema>;
export type InsertRefreshTokenReuseEvent = z.infer<typeof insertRefreshTokenReuseEventSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type FcmToken = typeof fcmTokens.$inferSelect;
export type CallbackNotification = typeof callbackNotificationQueue.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type RefreshTokenReuseEvent = typeof refreshTokenReuseEvents.$inferSelect;