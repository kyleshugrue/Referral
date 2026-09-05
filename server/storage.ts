import { users, connections, connectionRequests, messages, conversations, synergyMatches, notifications, userBlocks, matchGenerationJobs, matchGenerationDeadLetters, fcmTokens, callbackNotificationQueue, queuedPushNotifications, deliveryObligations, refreshTokens, refreshTokenReuseEvents, accountErasureJobs, type User, type Connection, type ConnectionRequest, type Message, type Conversation, type SynergyMatch, type InsertSynergyMatch, type Notification, type InsertNotification, type UserBlock, type MatchGenerationJob, type InsertMatchGenerationJob, type MatchGenerationDeadLetter, type InsertMatchGenerationDeadLetter, type CallbackNotification, type RefreshToken, type InsertRefreshToken, type InsertRefreshTokenReuseEvent, type InsertUser, type AccountErasureJob } from "@shared/schema";
import { buildMatchGenerationIdempotencyKey, getMatchGenerationScope } from "@shared/match-generation-contract";
import { db } from "./db";
import { eq, or, and, not, inArray, desc, sql, asc, ilike, lte, lt, gt, isNull } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";
import {
  assertSessionStorePoolCompatible,
  connectDatabase,
  createDatabasePool,
  queryDatabase,
  type DatabaseClient,
  type DatabasePool,
} from './lib/database-client';
import { locationCacheService } from './services/location-cache';
import { broadcastMatchRefresh, broadcastMatchRefreshToUsers } from './websocket-utils';
import { logger } from './lib/logger';
import { parseServerEnvironment } from './lib/env';
import { isActiveAccount } from './lib/account-status';
import { recordQueueEvent } from './lib/operational-metrics';
import { discoverableUserCondition, matchableUserCondition } from './lib/discoverability-policy';
import { hasRequiredFieldsForMatching } from './lib/profile-matching';
import { DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE, type MessageCursor } from './lib/message-pagination';

const PostgresSessionStore = connectPg(session);
type UserWrite = Partial<InsertUser> & Record<string, unknown>;

export interface IStorage {
  initialize(): Promise<void>;
  getUser(id: number): Promise<User | undefined>;
  canUserAccessLegacyMedia(userId: number, reference: string): Promise<boolean>;
  getUserByMediaReference(reference: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUsersByFirebaseUid(firebaseUid: string): Promise<User[]>;
  resolveUserForFirebaseIdentity(firebaseUid: string, email: string | null, emailVerified: boolean): Promise<User | undefined>;
  createUser(user: UserWrite): Promise<User>;
  updateUser(id: number, user: UserWrite): Promise<User>;
  updateUserEmail(id: number, newEmail: string): Promise<User>;
  linkUserToFirebaseUid(id: number, firebaseUid: string, emailVerified: boolean): Promise<User>;
  deleteUser(id: number): Promise<void>;
  requestAccountErasure(id: number): Promise<AccountErasureJob>;
  destroyUserSessions(userId: number): Promise<void>;
  claimNextAccountErasureJob(): Promise<AccountErasureJob | undefined>;
  completeAccountErasureJob(jobId: number, userId: number): Promise<void>;
  failAccountErasureJob(jobId: number, errorCode: string, manualReview: boolean): Promise<void>;
  createConnectionRequest(senderId: number, receiverId: number): Promise<ConnectionRequest>;
  getConnectionRequestById(requestId: number): Promise<ConnectionRequest | undefined>;
  getPendingRequestsReceived(userId: number): Promise<(ConnectionRequest & { sender: User })[]>;
  getPendingRequestsSent(userId: number): Promise<(ConnectionRequest & { receiver: User })[]>;
  getOutgoingRequests(userId: number): Promise<(ConnectionRequest & { receiver: User })[]>;
  acceptConnectionRequest(requestId: number, receiverId?: number): Promise<Connection | undefined>;
  rejectConnectionRequest(requestId: number, receiverId?: number): Promise<boolean>;
  getConnections(userId: number): Promise<(Connection & { otherUser: User })[]>;
  deleteConnection(userId: number, otherUserId: number): Promise<void>;
  getAllPotentialConnections(userId: number, page?: number, perPage?: number, searchParams?: Partial<User>): Promise<{ profiles: User[], hasMore: boolean }>;
  getAllUsers(): Promise<User[]>;
  getMatchingSynergies(userId: number): Promise<(User & { matchDescription?: string | null; matchScore?: number | null; matchReasons?: string[] })[]>;
  generateMatchesForUser(userId: number): Promise<(User & { matchDescription?: string | null; matchScore?: number | null; matchReasons?: string[] })[]>;
  getSavedSynergyMatches(userId: number): Promise<(SynergyMatch & { matchedUser: User })[]>;
  getSynergyMatchById(id: number): Promise<SynergyMatch | null>;
  saveSynergyMatch(match: InsertSynergyMatch): Promise<SynergyMatch>;
  claimSynergyMatchGeneration(match: InsertSynergyMatch & { generationJobKey: string }): Promise<SynergyMatch | undefined>;
  updateSynergyMatchForJob(id: number, generationJobKey: string, updates: Partial<Omit<SynergyMatch, 'id' | 'userId' | 'matchedUserId' | 'createdAt'>>): Promise<boolean>;
  updateSynergyMatchById(id: number, updates: Partial<Omit<SynergyMatch, 'id' | 'userId' | 'matchedUserId' | 'createdAt'>>): Promise<void>;
  clearSynergyMatchesForUser(userId: number): Promise<void>;
  markMatchesAsGenerating(userId: number): Promise<number>;
  hasGeneratingMatches(userId: number): Promise<boolean>;
  checkPendingMatchJob(userId: number): Promise<boolean>;
  hasCompletedMatchGeneration(userId: number): Promise<boolean>;
  findUsersMatchingWithUser(userId: number): Promise<number[]>;
  findPotentialMatchUserIds(userId: number): Promise<number[]>;
  createMessage(message: { senderId: number; receiverId: number; content: string; }): Promise<Message & { sender: User, receiver: User }>;
  sessionStore: session.Store;
  getMessages(user1Id: number, user2Id: number): Promise<(Message & { sender: User, receiver: User })[]>;
  getMessagesPage(
    user1Id: number,
    user2Id: number,
    options?: { limit?: number; cursor?: MessageCursor },
  ): Promise<{
    items: (Message & { sender: User, receiver: User })[];
    nextCursor?: string;
  }>;
  getConnectionBetweenUsers(userId: number, connectedUserId: number): Promise<Connection | undefined>;
  getOrCreateConversation(user1Id: number, user2Id: number): Promise<Conversation>;
  getConversationById(conversationId: number): Promise<Conversation | undefined>;
  getUserConversations(userId: number): Promise<(Conversation & { otherUser: User, lastMessage?: Message })[]>;
  searchConversationMessages(userId: number, searchQuery: string): Promise<(Conversation & { otherUser: User, lastMessage?: Message, hasUnreadMessages?: boolean })[]>;
  updateMessageStatus(messageId: number, userId: number, status: 'read' | 'delivered'): Promise<Message>;
  // User Block methods
  blockUser(userId: number, blockedUserId: number): Promise<UserBlock>;
  unblockUser(userId: number, blockedUserId: number): Promise<void>;
  getBlockedUsers(userId: number): Promise<(UserBlock & { blockedUser: User })[]>;
  isUserBlocked(userId: number, blockedUserId: number): Promise<boolean>;
  // Notification methods
  createNotification(notification: InsertNotification): Promise<Notification>;
  getNotificationsForRelatedId(userId: number, relatedId: number, type: string): Promise<Notification[]>;
  getUnreadNotifications(userId: number): Promise<Notification[]>;
  getUnreadNotificationCounts(userId: number): Promise<{ messages: number, connectionRequests: number, newConnections: number }>;
  markNotificationAsRead(notificationId: number, userId: number): Promise<Notification | undefined>;
  markAllNotificationsAsRead(userId: number, type?: string): Promise<void>;
  markConversationNotificationsAsRead(userId: number, conversationId: number): Promise<void>;
  markConnectionNotificationsAsRead(userId: number, connectionId: number): Promise<void>;
  // Background job management methods
  createMatchGenerationJob(job: InsertMatchGenerationJob): Promise<MatchGenerationJob>;
  getMatchGenerationJob(jobId: number): Promise<MatchGenerationJob | undefined>;
  getPendingMatchGenerationJobs(limit: number): Promise<MatchGenerationJob[]>;
  getPendingMatchGenerationJobsByPriority(limit: number, maxPriority: number): Promise<MatchGenerationJob[]>;
  claimPendingJob(maxPriority?: number): Promise<MatchGenerationJob | null>;
  recoverStaleQueueWork(staleBefore: string): Promise<{ jobs: number; callbacks: number; pushes: number }>;
  updateMatchGenerationJob(jobId: number, updates: Partial<MatchGenerationJob>, expectedStatus?: MatchGenerationJob['status']): Promise<boolean>;
  getMatchGenerationJobStats(): Promise<{ pending: number; processing: number; completed: number; failed: number; }>;
  deleteOldMatchGenerationJobs(cutoffDate: string): Promise<number>;
  // CMDCC: Centralized Match & Description Command Center methods
  getMatchesWithVersionFilter(userId: number, includeStale?: boolean): Promise<(SynergyMatch & { matchedUser: User })[]>;
  markMatchesStaleForUser(userId: number, reason: string): Promise<number>;
  getStaleMatchCountForUser(userId: number): Promise<number>;
  incrementUserProfileVersion(userId: number): Promise<User>;
  cancelStaleJobsForUser(userId: number, newProfileVersion: number): Promise<number>;
  // FCM Token methods for iOS native push notifications with multi-device support
  storeFcmToken(userId: number, deviceToken: string, platform: string, deviceId?: string, deviceModel?: string, osVersion?: string): Promise<void>;
  getFcmTokensByUserId(userId: number, platform?: string): Promise<string[]>;
  deleteFcmToken(deviceToken: string): Promise<void>;
  updateFcmTokenLastUsed(deviceToken: string): Promise<void>;
  deleteStaleTokens(daysOld: number): Promise<number>;
  // Queued push notification methods for APNs fallback
  enqueuePushNotification(userId: number, payload: string, priority: 'critical' | 'standard', expiresAt: string): Promise<void>;
  getPendingQueuedNotifications(limit: number): Promise<Array<{id: number, userId: number, payload: string, priority: string, attemptCount: number}>>;
  claimPendingQueuedNotification(): Promise<{id: number, userId: number, payload: string, priority: string, attemptCount: number} | null>;
  updateQueuedNotificationStatus(id: number, status: string, errorMessage?: string): Promise<void>;
  incrementQueuedNotificationAttempts(id: number): Promise<void>;
  deleteExpiredQueuedNotifications(): Promise<number>;
  getQueuedNotificationStats(): Promise<{pending: number, processing: number, failed: number}>;
  // Dead letter queue methods for permanently failed jobs
  moveJobToDeadLetterQueue(jobId: number, failureReason: string): Promise<void>;
  getDeadLetterJobs(limit: number): Promise<MatchGenerationDeadLetter[]>;
  retryDeadLetterJob(deadLetterId: number): Promise<void>;
  // Callback notification queue methods
  getPendingCallbackNotifications(limit: number): Promise<CallbackNotification[]>;
  enqueueCallbackNotification(
    userId: number,
    notificationType: string,
    payload: string,
    priority: number,
    expiresAt: string,
    dedupeKey?: string,
  ): Promise<CallbackNotification>;
  claimPendingCallbackNotification(): Promise<CallbackNotification | null>;
  updateCallbackNotification(id: number, updates: Partial<CallbackNotification>): Promise<void>;
  getCallbackNotificationStats(): Promise<{ pending: number; processing: number; failed: number }>;
  dispatchPendingDeliveryObligations(limit: number): Promise<number>;
  completeDeliveryObligation(dedupeKey: string): Promise<void>;
  // Refresh token management methods for JWT authentication
  // IMPORTANT: All tokenHash fields must be pre-hashed using hashRefreshToken() from jwt-service before calling these methods
  // Device-bound refresh tokens with rotation support for secure mobile authentication
  createRefreshToken(refreshTokenData: InsertRefreshToken): Promise<RefreshToken>;
  rotateRefreshToken(
    tokenHash: string,
    deviceId: string,
    successor: InsertRefreshToken,
  ): Promise<
    | { status: 'rotated'; token: RefreshToken; user: User }
    | { status: 'not_found' }
    | { status: 'expired'; userId: number }
    | { status: 'device_mismatch'; userId: number; expectedDeviceId: string }
    | { status: 'user_missing'; userId: number }
    | { status: 'account_inactive'; userId: number }
    | { status: 'account_inactive'; userId: number }
  >;
  getRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null>;
  getRefreshTokenByUserAndDevice(userId: number, deviceId: string): Promise<RefreshToken | null>;
  getRefreshTokensForUser(userId: number): Promise<Array<Pick<RefreshToken, 'id' | 'deviceId' | 'deviceInfo' | 'lastUsedAt' | 'expiresAt'>>>;
  deleteRefreshToken(tokenHash: string): Promise<void>;
  deleteRefreshTokensByDevice(userId: number, deviceId: string): Promise<void>;
  deleteAllUserTokens(userId: number): Promise<void>;
  updateRefreshTokenLastUsed(tokenHash: string): Promise<void>;
  cleanupExpiredTokens(): Promise<number>;
  logRefreshTokenReuse(reuseEvent: InsertRefreshTokenReuseEvent): Promise<void>;
}

export class FirebaseIdentityConflictError extends Error {
  constructor(message = 'Firebase identity conflicts with an existing account') {
    super(message);
    this.name = 'FirebaseIdentityConflictError';
  }
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;
  
  private matchesReadyListenPool: DatabasePool | null = null;
  private matchesReadyListenClient: DatabaseClient | null = null;
  private isReconnectingMatchesReady = false;
  private reconnectAttemptsMatchesReady = 0;
  private readonly MAX_RECONNECT_DELAY = 30000;

  constructor() {
    // Don't initialize sessionStore here - do it in initialize() method
    this.sessionStore = null as unknown as session.Store;
  }

  async initialize(): Promise<void> {
    try {
      logger.debug(`[${new Date().toISOString()}] Initializing database storage...`);

      // Test connection with longer timeout and retry logic
      let retries = 3;
      let lastError: Error | null = null;
      
      while (retries > 0) {
        try {
          const connectionTestPromise = queryDatabase(pool, 'SELECT NOW() as current_time');
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database connection timeout after 10s')), 10000);
          });

          await Promise.race([connectionTestPromise, timeoutPromise]);
          logger.debug(`[${new Date().toISOString()}] Database connection successful`);
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          retries--;
          logger.warn(`[${new Date().toISOString()}] Database connection attempt failed, retries left: ${retries}`, lastError.message);
          
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
          }
        }
      }
      
      if (retries === 0 && lastError) {
        throw lastError;
      }

      // Initialize session store
      logger.debug(`[${new Date().toISOString()}] Initializing session store...`);
      assertSessionStorePoolCompatible(pool);
      this.sessionStore = new PostgresSessionStore({
        pool,
        tableName: 'session',
        // Schema changes are release-time migrations, never a startup side
        // effect. Missing schema is surfaced by /api/ready and release checks.
        createTableIfMissing: false,
        ttl: Math.floor(parseServerEnvironment(process.env).sessionMaxAgeMs / 1000),
        disableTouch: true,
      });
      logger.debug(`[${new Date().toISOString()}] Session store initialized with bounded TTL and non-rolling expiry`);
      
      // SESSION PERSISTENCE: Verify session table exists and is accessible
      try {
        // security-scanner-ignore: Static query with no user input - safe to use sql template literal
        const sessionTableCheck = await db.execute(sql`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'session'
          )
        `);
        const sessionTableExists = sessionTableCheck.rows?.[0]?.exists;
        logger.info(`[${new Date().toISOString()}] 🔐 [SESSION-PERSISTENCE] Session table status:`, {
          tableExists: sessionTableExists,
          tableName: 'session',
          store: 'PostgreSQL (connect-pg-simple)',
          message: sessionTableExists ? 
            '✅ Session table ready - sessions will persist across server restarts' : 
            '⚠️ Session table missing - will be created automatically'
        });
      } catch (tableCheckError) {
        logger.warn(`[${new Date().toISOString()}] ⚠️ [SESSION-PERSISTENCE] Could not verify session table:`, tableCheckError);
      }

      await this.setupMatchesReadyListener();

    } catch (error) {
      logger.error(`[${new Date().toISOString()}] Database initialization failed:`, error);
      
      // Don't end the pool on initialization error, let it retry later
       throw new Error(`Failed to initialize database connection: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  /**
   * Setup PostgreSQL LISTEN connection for matches_ready notifications
   * This enables instant event-driven match updates instead of polling
   */
  private async setupMatchesReadyListener(): Promise<void> {
    try {
      console.log('[LISTEN:MatchesReady] 🔧 Setting up event-driven LISTEN connection to PostgreSQL...');
      
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL not configured');
      }

      // Guard against duplicate setup
      if (this.matchesReadyListenClient) {
        console.warn('[LISTEN:MatchesReady] Listener already exists, skipping duplicate setup');
        return;
      }

      // Create a dedicated pool for LISTEN
      this.matchesReadyListenPool = createDatabasePool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis: 0, // Never idle timeout - keep connection alive
        allowExitOnIdle: false
      });

      // Get a dedicated client and keep it connected (DO NOT RELEASE)
      this.matchesReadyListenClient = await connectDatabase(this.matchesReadyListenPool);
      
      // Register notification handler on the CLIENT (not pool)
      this.matchesReadyListenClient.onNotification((msg) => {
        if (msg.channel === 'matches_ready') {
          console.log(`[LISTEN:MatchesReady] 📨 Received NOTIFY event on channel: ${msg.channel}`);
          if (msg.payload) {
            this.handleMatchesReadyNotification(msg.payload);
          }
        }
      });

      // Register error handler on the CLIENT
      this.matchesReadyListenClient.onError((err) => {
        // Sanitizing logger, not console.error: pg/neon error objects carry
        // a `connectionString` property (full DATABASE_URL incl. password).
        logger.error('[LISTEN:MatchesReady] ❌ Client error:', err);
        this.reconnectMatchesReadyListener();
      });

      // Issue LISTEN command and keep connection alive
      await this.matchesReadyListenClient.query('LISTEN matches_ready');
      console.log('[LISTEN:MatchesReady] ✅ Event-driven LISTEN connection established successfully');
      console.log('[LISTEN:MatchesReady] 🎯 Listening for "matches_ready" notifications - match updates will be instant!');
      console.log('[LISTEN:MatchesReady] 🔌 Dedicated client connection kept alive (not released to pool)');
      
      this.reconnectAttemptsMatchesReady = 0;
      
    } catch (error) {
      logger.error('[LISTEN:MatchesReady] ❌ Failed to setup LISTEN connection:', error);
      this.reconnectMatchesReadyListener();
    }
  }

  /**
   * Handle matches_ready NOTIFY event from PostgreSQL
   * This broadcasts instant WebSocket updates to connected users
   */
  private handleMatchesReadyNotification(payload: string): void {
    try {
      const data = JSON.parse(payload);
      const userId = data.userId;
      const timestamp = data.timestamp;
      
      console.log(`[LISTEN:MatchesReady] 🎉 Matches ready for user ${userId} (timestamp: ${timestamp})`);
      console.log(`[LISTEN:MatchesReady] 📡 Broadcasting instant WebSocket refresh to user ${userId}...`);
      
      broadcastMatchRefresh(userId);
      
      console.log(`[LISTEN:MatchesReady] ✅ WebSocket broadcast complete for user ${userId} - UI should update instantly`);
      
    } catch (error) {
      console.error('[LISTEN:MatchesReady] ❌ Error handling notification:', error);
      console.error('[LISTEN:MatchesReady] Payload was:', payload);
    }
  }

  /**
   * Reconnect matches_ready LISTEN connection with exponential backoff
   */
  private async reconnectMatchesReadyListener(): Promise<void> {
    if (this.isReconnectingMatchesReady) {
      return;
    }
    
    this.isReconnectingMatchesReady = true;
    
    try {
      // Clean up existing client - DO NOT use release(), just end the connection
      if (this.matchesReadyListenClient) {
        try {
          // CRITICAL: Do not call release() on a dedicated client - just null it out
          // The pool cleanup below will handle closing the connection properly
          this.matchesReadyListenClient = null;
        } catch (err) {
          logger.debug('[LISTEN:MatchesReady] Error cleaning client during reconnect:', err);
        }
      }
      
      // End the pool, which will close all its connections including our dedicated client
      if (this.matchesReadyListenPool) {
        try {
          await this.matchesReadyListenPool.end();
        } catch (err) {
          logger.debug('[LISTEN:MatchesReady] Error ending pool during reconnect:', err);
        }
        this.matchesReadyListenPool = null;
      }
      
      const backoffDelay = Math.min(
        1000 * Math.pow(2, this.reconnectAttemptsMatchesReady),
        this.MAX_RECONNECT_DELAY
      );
      
      this.reconnectAttemptsMatchesReady++;
      logger.debug(`[LISTEN:MatchesReady] Reconnecting in ${backoffDelay}ms (attempt ${this.reconnectAttemptsMatchesReady})...`);
      
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
      
      await this.setupMatchesReadyListener();
      
      this.isReconnectingMatchesReady = false;
      
    } catch (error) {
      logger.error('[LISTEN:MatchesReady] Reconnection failed:', error);
      this.isReconnectingMatchesReady = false;
      this.reconnectMatchesReadyListener();
    }
  }

  async getUser(id: number): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user;
    } catch (error) {
      logger.error(`[Storage] Error fetching user ${id}:`, error);
      // For connection errors, throw explicit error instead of silently returning undefined
      if (error instanceof Error && (error.message.includes('57P01') || error.message.includes('ECONNRESET'))) {
        logger.error(`[Storage] Database connection issue for user ${id}:`, error);
         throw new Error(`Database connection failed while fetching user ${id}: ${error.message}`, { cause: error });
      }
      throw error;
    }
  }

  async canUserAccessLegacyMedia(userId: number, reference: string): Promise<boolean> {
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.id, userId),
        or(
          eq(users.photo, reference),
          eq(users.resumeUrl, reference),
          sql`${reference} = ANY(${users.resumePreviewUrls})`,
        ),
      ))
      .limit(1);
    return Boolean(owner);
  }

  async getUserByMediaReference(reference: string): Promise<User | undefined> {
    const [owner] = await db
      .select()
      .from(users)
      .where(or(
        eq(users.photo, reference),
        eq(users.resumeUrl, reference),
        sql`${reference} = ANY(${users.resumePreviewUrls})`,
      ))
      .limit(1);
    return owner;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.email, email));
      return user;
    } catch (error) {
      logger.error(`[Storage] Error fetching user by email ${email}:`, error);
      // For connection errors, return undefined instead of throwing
      if (error instanceof Error && (error.message.includes('57P01') || error.message.includes('ECONNRESET'))) {
        logger.warn(`[Storage] Database connection issue, returning undefined for user email ${email}`);
        return undefined;
      }
      throw error;
    }
  }
  
  async getUsersByFirebaseUid(firebaseUid: string): Promise<User[]> {
    return await db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
  }

  async resolveUserForFirebaseIdentity(
    firebaseUid: string,
    email: string | null,
    emailVerified: boolean,
  ): Promise<User | undefined> {
    return db.transaction(async (tx) => {
      const identityPredicates = [eq(users.firebaseUid, firebaseUid)];
      if (email) identityPredicates.push(eq(users.email, email));

      const matches = await tx
        .select()
        .from(users)
        .where(identityPredicates.length === 1 ? identityPredicates[0] : or(...identityPredicates))
        .limit(2);

      const byUid = matches.find((user) => user.firebaseUid === firebaseUid);
      const byEmail = email ? matches.find((user) => user.email === email) : undefined;

      if (byUid && byEmail && byUid.id !== byEmail.id) {
        throw new FirebaseIdentityConflictError();
      }

      const existing = byUid ?? byEmail;
      if (!existing) return undefined;
      if (existing.accountStatus !== 'active') {
        throw new FirebaseIdentityConflictError('Account is not active');
      }

      if (byUid) {
        if (!emailVerified || existing.emailVerified) return existing;

        const [verified] = await tx
          .update(users)
          .set({ emailVerified: true })
          .where(eq(users.id, existing.id))
          .returning();
        return verified ?? existing;
      }

      if (existing.firebaseUid && existing.firebaseUid !== firebaseUid) {
        throw new FirebaseIdentityConflictError();
      }
      if (!emailVerified) {
        throw new FirebaseIdentityConflictError(
          'Email verification is required before linking this existing account',
        );
      }

      const [linked] = await tx
        .update(users)
        .set({
          firebaseUid,
          emailVerified: true,
        })
        .where(and(eq(users.id, existing.id), isNull(users.firebaseUid)))
        .returning();

      if (linked) return linked;

      const [current] = await tx
        .select()
        .from(users)
        .where(eq(users.id, existing.id))
        .limit(1);
      if (current?.firebaseUid === firebaseUid) return current;
      throw new FirebaseIdentityConflictError();
    });
  }

  async createUser(insertUser: UserWrite): Promise<User> {
    logger.debug("[Storage] Creating user with data:", {
      email: insertUser.email,
      fullName: insertUser.fullName,
      title: insertUser.title,
      industry: insertUser.industry,
      currentLocation: insertUser.currentLocation,
      currentCompany: insertUser.currentCompany,
      bio: insertUser.bio,
      resumeUrl: insertUser.resumeUrl,
      desiredLocations: insertUser.desiredLocations ? JSON.stringify(insertUser.desiredLocations) : [],
      desiredCompanies: insertUser.desiredCompanies ? JSON.stringify(insertUser.desiredCompanies) : [],
      interests: insertUser.interests ? JSON.stringify(insertUser.interests) : [],
      professionalInterests: insertUser.professionalInterests ? JSON.stringify(insertUser.professionalInterests) : [],
      languages: insertUser.languages ? JSON.stringify(insertUser.languages) : []
    });
    
    // Ensure array fields are properly formatted
    const userData = { ...insertUser };
    
    // Process all array fields to ensure they're always arrays
    const arrayFields = [
      'resumePreviewUrls', 
      'desiredLocations', 
      'desiredCompanies',
      'interests',
      'professionalInterests',
      'languages'
    ];
    
    // Process each array field to ensure it's properly formatted, but only if provided
    arrayFields.forEach(field => {
      if (userData[field] !== undefined) {
        // If it's not already an array, try to convert it
        if (!Array.isArray(userData[field])) {
          logger.warn(`[Storage] Converting ${field} to array:`, userData[field]);
          
          // If it's a string (possibly JSON), try to parse it
          if (typeof userData[field] === 'string' && userData[field].startsWith('[')) {
            try {
              userData[field] = JSON.parse(userData[field]);
            } catch (e) {
              logger.error(`[Storage] Failed to parse ${field} JSON:`, e);
              // Don't set to empty array - keep as undefined if parsing fails
              userData[field] = undefined;
            }
          } else if (typeof userData[field] === 'string' && userData[field].trim() !== '') {
            // If it's a non-empty string but not JSON, make it a single-element array
            userData[field] = [userData[field]];
          } else {
            // Don't default to empty array - set to undefined to leave field empty
            userData[field] = undefined;
          }
        }
      }
      // We're not setting any defaults for undefined fields
      // This leaves all fields as the user provided them
    });
    
    // Convert arrays to properly formatted arrays for PostgreSQL
    // This ensures array fields are properly inserted into database
    const finalUserData = { ...userData };
    arrayFields.forEach(field => {
      // Only process this field if it's defined in userData
      if (finalUserData[field] !== undefined) {
        // Ensure it's an array but don't add defaults
        if (!Array.isArray(finalUserData[field])) {
          // Only convert to array if there's a value, otherwise leave as undefined
          finalUserData[field] = finalUserData[field] ? [finalUserData[field]] : undefined;
        }
        
        // Preserve empty arrays for AI connection preferences, but convert other empty arrays to undefined
        if (Array.isArray(finalUserData[field]) && finalUserData[field].length === 0) {
          // Keep empty arrays for AI connection preferences since they're meaningful (user selected no preferences)
          if (field !== 'desiredLocations' && field !== 'desiredCompanies') {
            finalUserData[field] = undefined;
          }
          // For desiredLocations and desiredCompanies, keep the empty array
        }
        
        logger.debug(`[Storage] Final ${field} value:`, finalUserData[field]);
      }
    });
    
    try {
      // Create a new object that matches the schema
      // Only include fields that are actually provided, no defaults
      const insertData = {
        // Email is required by DB schema
        email: finalUserData.email,
        // Full name is required by DB schema - provide empty string if not provided
        fullName: finalUserData.fullName || '',
        // Include other fields only if they exist in the input data
        ...(finalUserData.birthday !== undefined && { birthday: finalUserData.birthday }),
        ...(finalUserData.title !== undefined && { title: finalUserData.title }),
        ...(finalUserData.currentLocation !== undefined && { currentLocation: finalUserData.currentLocation }),
        ...(finalUserData.industry !== undefined && { industry: finalUserData.industry }),
        ...(finalUserData.currentCompany !== undefined && { currentCompany: finalUserData.currentCompany }),
        ...(finalUserData.yearsOfExperience !== undefined && { yearsOfExperience: finalUserData.yearsOfExperience }),
        ...(finalUserData.bio !== undefined && { bio: finalUserData.bio }),
        ...(finalUserData.photo !== undefined && { photo: finalUserData.photo }),
        ...(finalUserData.resumeUrl !== undefined && { resumeUrl: finalUserData.resumeUrl }),
        ...(finalUserData.resumePreviewUrls !== undefined && { resumePreviewUrls: finalUserData.resumePreviewUrls }),
        ...(finalUserData.interests !== undefined && { interests: finalUserData.interests }),
        ...(finalUserData.professionalInterests !== undefined && { professionalInterests: finalUserData.professionalInterests }),
        ...(finalUserData.languages !== undefined && { languages: finalUserData.languages }),
        ...(finalUserData.desiredLocations !== undefined && { desiredLocations: finalUserData.desiredLocations }),
        ...(finalUserData.desiredCompanies !== undefined && { desiredCompanies: finalUserData.desiredCompanies }),
        ...(finalUserData.institution !== undefined && { institution: finalUserData.institution }),
        ...(finalUserData.firebaseUid !== undefined && { firebaseUid: finalUserData.firebaseUid }),
        ...(finalUserData.profileVisible !== undefined && { profileVisible: finalUserData.profileVisible }),
        ...(finalUserData.emailNotifications !== undefined && { emailNotifications: finalUserData.emailNotifications }),
        ...(finalUserData.readReceipts !== undefined && { readReceipts: finalUserData.readReceipts }),
        ...(finalUserData.educationLevel !== undefined && { educationLevel: finalUserData.educationLevel }),
        ...(finalUserData.timezone !== undefined && { timezone: finalUserData.timezone }),
        // Minimum-match readiness is derived from the validated profile,
        // never accepted from caller-controlled state.
        hasMinimumMatchData: hasRequiredFieldsForMatching({
          ...finalUserData,
          fullName: finalUserData.fullName || '',
          desiredCompanies: finalUserData.desiredCompanies ?? [],
          desiredLocations: finalUserData.desiredLocations ?? [],
        } as User),
      };
      
      const [user] = await db.insert(users).values([insertData as unknown as InsertUser]).returning();
      logger.debug("[Storage] User created successfully with ID:", user.id);
      
      // Trigger background match generation if user has minimum required fields
      // This ensures matches are ready when user navigates to matches page (zero-wait UX)
      const hasMinimumFields = user.industry && user.industry.trim().length > 0 &&
                                Array.isArray(user.desiredCompanies) && user.desiredCompanies.length > 0 &&
                                Array.isArray(user.desiredLocations) && user.desiredLocations.length > 0 && 
                                user.fullName && user.fullName.trim().length > 0 &&
                                user.currentCompany && user.currentCompany.trim().length > 0 &&
                                user.currentLocation && user.currentLocation.trim().length > 0;
      if (hasMinimumFields && user.emailVerified && user.registrationCompleted) {
        console.log(`[createUser] User ${user.id} has minimum required fields, triggering background match generation`);
        
        try {
          // Use CMDCC incremental update to generate initial matches in background
          // Pass empty object for oldProfile since this is a new user
          // Import dynamically to avoid circular dependency
          const { centralizedMatchDescriptionCommandCenter } = await import('./services/centralized-match-description-command-center.js');
          await centralizedMatchDescriptionCommandCenter.handleIncrementalProfileUpdate(
            user.id,
            {}, // Empty profile for new users - all fields are new
            user
          );
          console.log(`[createUser] Background match generation triggered for new user ${user.id}`);
        } catch (error) {
          console.error(`[createUser] Error triggering background match generation for user ${user.id}:`, error);
          // Don't throw here - the user creation was successful
        }
      } else {
        console.log(`[createUser] User ${user.id} does not have minimum required fields yet, skipping background match generation`);
      }
      
      return user;
    } catch (error) {
      logger.error("[Storage] Error creating user:", error);
      throw error;
    }
  }
  


  async updateUser(id: number, updateData: UserWrite): Promise<User> {
    // Fetch existing user FIRST for value comparison in background tasks
    // This is needed to detect ACTUAL changes vs repopulated existing values
    const existingUserForComparison = await this.getUserById(id);
    
    // Clean the update data to remove undefined fields
    const cleanUpdateData: UserWrite = {};
    
    // Only include fields that are defined in the updateData
    for (const key in updateData) {
      if (updateData[key] !== undefined) {
        cleanUpdateData[key] = updateData[key];
      }
    }
    
    // Log what's being updated, but don't include undefined fields in the log
    logger.debug(`[updateUser] Updating user ${id} with data:`, {
      ...cleanUpdateData,
      desiredLocations: cleanUpdateData.desiredLocations ? JSON.stringify(cleanUpdateData.desiredLocations) : cleanUpdateData.desiredLocations,
      desiredCompanies: cleanUpdateData.desiredCompanies ? JSON.stringify(cleanUpdateData.desiredCompanies) : cleanUpdateData.desiredCompanies,
      interests: cleanUpdateData.interests ? JSON.stringify(cleanUpdateData.interests) : cleanUpdateData.interests,
      professionalInterests: cleanUpdateData.professionalInterests ? JSON.stringify(cleanUpdateData.professionalInterests) : cleanUpdateData.professionalInterests,
      languages: cleanUpdateData.languages ? JSON.stringify(cleanUpdateData.languages) : cleanUpdateData.languages
    });
    
    // Process update data to ensure array fields are properly formatted
    const processedData = { ...cleanUpdateData };
    
    // Process all array fields to ensure they're always arrays
    const arrayFields = [
      'resumePreviewUrls', 
      'desiredLocations', 
      'desiredCompanies',
      'interests',
      'professionalInterests',
      'languages'
    ];
    
    // Process each array field to ensure it's properly formatted
    arrayFields.forEach(field => {
      if (processedData[field] !== undefined) {
        // Handle null directly for registration data
        if (processedData[field] === null) {
          logger.debug(`[updateUser] Converting null to empty array for ${field}`);
          processedData[field] = [];
          return;
        }
        
        // Handle "null" string that might come from client JSON.stringify
        if (processedData[field] === "null") {
          logger.debug(`[updateUser] Setting ${field} to empty array for null string value`);
          processedData[field] = [];
          return;
        }
      
        // If it's already an array, keep it as is
        if (Array.isArray(processedData[field])) {
          logger.debug(`[updateUser] Field ${field} is already a properly formatted array`);
          return;
        }
        
        logger.warn(`[updateUser] Converting ${field} to array:`, processedData[field]);
        
        // If it's a string (possibly JSON), try to parse it
        if (typeof processedData[field] === 'string') {
          // If it looks like JSON array, try to parse it
          if (processedData[field].startsWith('[')) {
            try {
              const parsed = JSON.parse(processedData[field]);
              if (parsed === null) {
                processedData[field] = [];
              } else {
                processedData[field] = parsed;
              }
            } catch (e) {
              logger.error(`[updateUser] Failed to parse ${field} JSON:`, e);
              // If parsing fails but it's a non-empty string, make it a single-element array
              const value = processedData[field];
              if (typeof value === 'string' && value.trim() !== '') {
                processedData[field] = [value];
              } else {
                processedData[field] = [];
              }
            }
          } 
          // If it's just a regular string value, make it a single-element array
          else if (processedData[field].trim() !== '') {
            processedData[field] = [processedData[field]];
          } 
          // Empty string becomes empty array
          else {
            processedData[field] = [];
          }
        } 
        // For any other non-null value that's not an array, wrap it in array
        else if (processedData[field] !== undefined) {
          processedData[field] = [processedData[field]];
        }
      }
    });

    // Recompute readiness synchronously from the post-update profile before
    // persisting it. Completion and queue decisions must never observe the
    // stale flag from before this update, and callers cannot supply this flag.
    const candidateUser = {
      ...existingUserForComparison,
      ...processedData,
    } as User;
    const computedHasMinimumMatchData = hasRequiredFieldsForMatching(candidateUser);
    processedData.hasMinimumMatchData = computedHasMinimumMatchData;

    // A new completion claim is valid only when the same validated profile
    // already satisfies the minimum requirements. Existing completed users
    // retain completion even if they later edit match preferences down.
    if (
      processedData.registrationCompleted === true &&
      !computedHasMinimumMatchData &&
      existingUserForComparison?.registrationCompleted !== true
    ) {
      processedData.registrationCompleted = false;
    }
    
    // Ensure arrays are correctly formatted for PostgreSQL
    const finalData = { ...processedData };
    arrayFields.forEach(field => {
      if (finalData[field] !== undefined) {
        // Ensure it's an array before sending to database
        if (Array.isArray(finalData[field])) {
          logger.debug(`[updateUser] Field ${field} is already an array:`, finalData[field]);
          
          // We want to preserve empty arrays for these fields so they can be explicitly cleared
          // Only log that we're keeping the empty array
          if (finalData[field].length === 0) {
            logger.debug(`[updateUser] Preserving empty array for ${field} to allow clearing`);
          }
        } else {
          logger.warn(`[updateUser] Field ${field} still not an array after processing:`, finalData[field]);
          if (finalData[field] === null || finalData[field] === "" || finalData[field] === "null") {
            // If null, empty string, or "null" string is explicitly provided, convert to empty array
            logger.debug(`[updateUser] Converting ${finalData[field]} to empty array for ${field}`);
            finalData[field] = [];
          } else if (finalData[field]) {
            // For non-empty values, wrap in array
            finalData[field] = [finalData[field]];
          } else {
            // For undefined or empty strings, use undefined
            finalData[field] = undefined;
          }
        }
        logger.debug(`[updateUser] Final ${field} value:`, finalData[field]);
      }
    });
    
    try {
      const [user] = await db
        .update(users)
        .set(finalData)
        .where(eq(users.id, id))
        .returning();
      
      if (!user) {
        logger.error(`[updateUser] User ${id} not found`);
        throw new Error("User not found");
      }
      
      logger.debug(`[updateUser] Successfully updated user ${id} - returning immediately, background tasks will run async`);
      
      // FIRE-AND-FORGET BACKGROUND TASKS
      // All background work runs after the user is returned to ensure fast HTTP responses
      // Failures in background tasks will NOT crash the user save operation
      
      setImmediate(() => {
        // Wrap all background tasks in async IIFE with comprehensive error handling
        (async () => {
          try {
            // === BACKGROUND TASK 1: Location caching ===
            const locationPromises: Promise<unknown>[] = [];
            
            if (finalData.currentLocation !== undefined) {
              logger.debug(`[updateUser] Background: Caching current location for user ${id}: ${finalData.currentLocation}`);
              locationPromises.push(
                locationCacheService.updateUserCurrentLocation(id, finalData.currentLocation)
                  .catch(error => logger.error(`[updateUser] Background: Error caching current location for user ${id}:`, error))
              );
            }
            
            if (finalData.desiredLocations !== undefined && Array.isArray(finalData.desiredLocations)) {
              logger.debug(`[updateUser] Background: Caching desired locations for user ${id}: ${finalData.desiredLocations.join(', ')}`);
              locationPromises.push(
                locationCacheService.updateUserDesiredLocations(id, finalData.desiredLocations)
                  .catch(error => logger.error(`[updateUser] Background: Error caching desired locations for user ${id}:`, error))
              );
            }
            
            if (locationPromises.length > 0) {
              await Promise.all(locationPromises).catch(error => {
                logger.error(`[updateUser] Background: Location caching failed for user ${id}:`, error);
              });
              logger.debug(`[updateUser] Background: Location caching completed for user ${id}`);
            }
            
            // === BACKGROUND TASK 3: Match refresh ===
            // CRITICAL: Only these 5 fields should trigger match regeneration
            // AND only if the VALUE actually changed (not just repopulated with existing value)
            const matchRelevantFields = [
              'currentCompany', 'currentLocation', 'industry', 
              'desiredCompanies', 'desiredLocations'
            ];
            
            // Helper function to compare values (handles arrays with deep equality)
            const valuesAreDifferent = (oldVal: unknown, newVal: unknown): boolean => {
              if (newVal === undefined) return false; // Field not in update
              if (Array.isArray(oldVal) && Array.isArray(newVal)) {
                return JSON.stringify(oldVal.slice().sort()) !== JSON.stringify(newVal.slice().sort());
              }
              return oldVal !== newVal;
            };
            
            // Compare against existing user values, not just check if field exists
            const hasMatchRelevantChanges = existingUserForComparison ? matchRelevantFields.some(field => {
              const oldValue = (existingUserForComparison as Record<string, unknown>)[field];
              const newValue = finalData[field];
              const isDifferent = valuesAreDifferent(oldValue, newValue);
              if (isDifferent) {
                logger.debug(`[updateUser] Background: Match-relevant field '${field}' changed from '${JSON.stringify(oldValue)}' to '${JSON.stringify(newValue)}'`);
              }
              return isDifferent;
            }) : false;
            
            if (hasMatchRelevantChanges) {
              logger.debug(`[updateUser] Background: Match-relevant field VALUES changed, triggering match refresh for user ${id}`);
              try {
                await this.clearSynergyMatchesForUser(id);
                logger.debug(`[updateUser] Background: Cleared existing matches for user ${id}`);
                
                await broadcastMatchRefresh(id);
                logger.debug(`[updateUser] Background: Broadcasted match refresh to user ${id}`);
              } catch (error) {
                logger.error(`[updateUser] Background: Match refresh failed for user ${id}:`, error);
              }
            }
            
            logger.debug(`[updateUser] Background: All background tasks completed for user ${id}`);
            
          } catch (outerError) {
            logger.error(`[updateUser] Background: Unexpected error in background tasks for user ${id}:`, outerError);
          }
        })();
      });
      
      return user;
    } catch (error) {
      logger.error(`[updateUser] Error updating user ${id}:`, error);
      throw error;
    }
  }
  
  async updateUserEmail(id: number, newEmail: string): Promise<User> {
    logger.debug(`[Storage] Updating email for user ${id} to ${newEmail}`);
    
    try {
      // Check if email already exists for another user
      const existingUser = await this.getUserByEmail(newEmail);
      if (existingUser && existingUser.id !== id) {
        logger.error(`[Storage] Email ${newEmail} already in use by user ${existingUser.id}`);
        throw new Error("Email already in use by another user");
      }
      
      // Update the user's email
      const [user] = await db
        .update(users)
        .set({ email: newEmail })
        .where(eq(users.id, id))
        .returning();
      
      if (!user) {
        logger.error(`[Storage] User ${id} not found when updating email`);
        throw new Error("User not found");
      }
      
      logger.debug(`[Storage] Successfully updated email for user ${id} to ${newEmail}`);
      return user;
    } catch (error) {
      logger.error(`[Storage] Error updating email for user ${id}:`, error);
      throw error;
    }
  }

  async linkUserToFirebaseUid(id: number, firebaseUid: string, emailVerified: boolean): Promise<User> {
    const [linked] = await db
      .update(users)
      .set({
        firebaseUid,
        ...(emailVerified ? { emailVerified: true } : {}),
      })
      .where(and(eq(users.id, id), isNull(users.firebaseUid)))
      .returning();
    if (linked) return linked;

    const [sameIdentity] = await db.select().from(users).where(and(
      eq(users.id, id),
      eq(users.firebaseUid, firebaseUid),
    )).limit(1);
    if (sameIdentity) {
      if (!emailVerified || sameIdentity.emailVerified) return sameIdentity;
      const [verified] = await db.update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, id))
        .returning();
      if (verified) return verified;
    }
    throw new Error("Firebase identity is already linked to another account");
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(connections).where(
      or(
        eq(connections.user1Id, id),
        eq(connections.user2Id, id)
      )
    );
    await db.delete(users).where(eq(users.id, id));
  }

  async requestAccountErasure(id: number): Promise<AccountErasureJob> {
    const job = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!user) throw new Error('User not found');
      const now = new Date().toISOString();
      await tx.update(users).set({
        accountStatus: user.accountStatus === 'erased' ? 'erased' : 'deletion_pending',
        profileVisible: false,
        registrationCompleted: false,
        hasMinimumMatchData: false,
        deletionRequestedAt: user.deletionRequestedAt || now,
      }).where(eq(users.id, id));
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, id));
      await tx.delete(fcmTokens).where(eq(fcmTokens.userId, id));
      const [existingJob] = await tx.select().from(accountErasureJobs)
        .where(eq(accountErasureJobs.userId, id))
        .limit(1);
      if (existingJob?.status === 'completed') return existingJob;
      const [job] = await tx.insert(accountErasureJobs).values({
        userId: id,
        status: 'pending',
        requestedAt: user.deletionRequestedAt || now,
      }).onConflictDoUpdate({
        target: accountErasureJobs.userId,
        set: { status: 'pending', nextAttemptAt: now },
      }).returning();
      if (!job) throw new Error('Unable to create account-erasure job');
      logger.info('[Storage] Account-erasure job requested', { jobId: job.id });
      return job;
    });

    try {
      await this.destroyUserSessions(id);
    } catch (error) {
      // Database account status is the authorization boundary. Session
      // cleanup is best-effort so a store outage cannot undo the fail-closed
      // deletion transition or make the request look like it succeeded safely.
      logger.warn('[Storage] Server-session cleanup deferred after account erasure request', {
        userId: id,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    return job;
  }

  async destroyUserSessions(userId: number): Promise<void> {
    const result = await queryDatabase(
      pool,
      `DELETE FROM "session"
       WHERE COALESCE(sess->'passport'->>'user', sess->>'userId') = $1`,
      [String(userId)],
    );
    logger.info('[Storage] Destroyed server sessions for account erasure', {
      userId,
      deletedSessions: result.rowCount ?? 0,
    });
  }

  async claimNextAccountErasureJob(): Promise<AccountErasureJob | undefined> {
    return db.transaction(async (tx) => {
      const [job] = await tx.select().from(accountErasureJobs)
        .where(and(
          inArray(accountErasureJobs.status, ['pending', 'retrying']),
          lte(accountErasureJobs.nextAttemptAt, sql`now()`),
        ))
        .orderBy(asc(accountErasureJobs.nextAttemptAt), asc(accountErasureJobs.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!job) return undefined;
      const [claimed] = await tx.update(accountErasureJobs).set({
        status: 'processing',
        attemptCount: sql`${accountErasureJobs.attemptCount} + 1`,
        startedAt: new Date().toISOString(),
      }).where(and(eq(accountErasureJobs.id, job.id), inArray(accountErasureJobs.status, ['pending', 'retrying']))).returning();
      return claimed;
    });
  }

  async completeAccountErasureJob(jobId: number, userId: number): Promise<void> {
    await db.transaction(async (tx) => {
      const now = new Date().toISOString();
      await tx.update(users).set({
        accountStatus: 'erased',
        email: `erased-${userId}@invalid.local`,
        fullName: 'Deleted user',
        birthday: null,
        title: null,
        currentLocation: null,
        currentLocationLat: null,
        currentLocationLng: null,
        firebaseUid: null,
        desiredLocations: null,
        desiredLocationCoords: null,
        industry: null,
        currentCompany: null,
        desiredCompanies: null,
        bio: null,
        resumeUrl: null,
        resumePreviewUrls: null,
        interests: [],
        professionalInterests: [],
        languages: [],
        educationLevel: null,
        institution: null,
        photo: '/placeholder.jpg',
        deletionCompletedAt: now,
      }).where(eq(users.id, userId));
      await tx.update(accountErasureJobs).set({ status: 'completed', completedAt: now, lastErrorCode: null })
        .where(eq(accountErasureJobs.id, jobId));
    });
  }

  async failAccountErasureJob(jobId: number, errorCode: string, manualReview: boolean): Promise<void> {
    const nextAttemptAt = new Date(Date.now() + 5 * 60_000).toISOString();
    await db.update(accountErasureJobs).set({
      status: manualReview ? 'manual_review' : 'retrying',
      nextAttemptAt,
      lastErrorCode: errorCode.slice(0, 120),
    }).where(eq(accountErasureJobs.id, jobId));
  }

  async createConnectionRequest(senderId: number, receiverId: number): Promise<ConnectionRequest> {
    if (senderId === receiverId) throw new Error("Cannot connect with yourself");

    const result = await db.transaction(async (tx) => {
      const [blocked] = await tx
        .select({ id: userBlocks.id })
        .from(userBlocks)
        .where(or(
          and(eq(userBlocks.userId, senderId), eq(userBlocks.blockedUserId, receiverId)),
          and(eq(userBlocks.userId, receiverId), eq(userBlocks.blockedUserId, senderId)),
        ))
        .limit(1);
      if (blocked) throw new Error("Users cannot connect");

      const [existingConnection] = await tx
        .select({ id: connections.id })
        .from(connections)
        .where(or(
          and(eq(connections.user1Id, senderId), eq(connections.user2Id, receiverId)),
          and(eq(connections.user1Id, receiverId), eq(connections.user2Id, senderId)),
        ))
        .limit(1);
      if (existingConnection) throw new Error("Users are already connected");

      const [request] = await tx
        .insert(connectionRequests)
        .values({
          senderId,
          receiverId,
          status: "requested",
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .returning();
      if (!request) throw new Error("Connection request already exists");

      await tx.insert(notifications).values({
        userId: receiverId,
        type: "connection_request",
        relatedId: request.id,
        read: false,
        createdAt: new Date().toISOString(),
      }).onConflictDoNothing();

      await tx.insert(deliveryObligations).values({
        userId: receiverId,
        eventType: 'connectionRequest',
        payload: JSON.stringify({ senderId, requestId: request.id }),
        dedupeKey: `connection-request:${request.id}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: 'pending',
      });

      return request;
    });

    return result;
  }
  
  async getConnectionRequestById(requestId: number): Promise<ConnectionRequest | undefined> {
    try {
      logger.debug(`[Storage] Getting connection request by ID: ${requestId}`);
      const [request] = await db
        .select()
        .from(connectionRequests)
        .where(eq(connectionRequests.id, requestId));
      
      return request;
    } catch (error) {
      logger.error(`[Storage] Error getting connection request by ID ${requestId}:`, error);
      throw error;
    }
  }

  async getPendingRequestsReceived(userId: number): Promise<(ConnectionRequest & { sender: User, matchDescription?: string })[]> {
    const result = await db
      .select({
        request: connectionRequests,
        sender: users,
      })
      .from(connectionRequests)
      .where(eq(connectionRequests.receiverId, userId))
      .innerJoin(users, eq(connectionRequests.senderId, users.id));

    // Create array of requests with basic info
    const requests = result.map(({ request, sender }) => ({
      ...request,
      sender,
      matchDescription: undefined as string | undefined
    }));

    // For each request, check if there's a synergy match with a description
    for (const request of requests) {
      try {
        logger.debug(`[getPendingRequestsReceived] Checking for synergy match between users ${userId} and ${request.senderId}`);
        
        // Check in the synergyMatches table for this pair of users
        const synergyMatch = await db
          .select()
          .from(synergyMatches)
          .where(
            and(
              eq(synergyMatches.userId, userId),
              eq(synergyMatches.matchedUserId, request.senderId)
            )
          )
          .limit(1);

        if (synergyMatch.length > 0 && synergyMatch[0].description) {
          logger.debug(`[getPendingRequestsReceived] Found synergy match with description for request ${request.id}`);
          request.matchDescription = synergyMatch[0].description;
        }
      } catch (error) {
        logger.error(`[getPendingRequestsReceived] Error checking synergy match for request ${request.id}:`, error);
        // Continue with the next request if there's an error
      }
    }

    const visibleRequests = [];
    for (const request of requests) {
      const [blockedByReceiver, blockedBySender] = await Promise.all([
        this.isUserBlocked(userId, request.senderId),
        this.isUserBlocked(request.senderId, userId),
      ]);
      if (!blockedByReceiver && !blockedBySender) visibleRequests.push(request);
    }
    return visibleRequests;
  }

  async getPendingRequestsSent(userId: number): Promise<(ConnectionRequest & { receiver: User })[]> {
    const result = await db
      .select({
        request: connectionRequests,
        receiver: users,
      })
      .from(connectionRequests)
      .where(
        and(
          eq(connectionRequests.senderId, userId),
          eq(connectionRequests.status, "requested")
        )
      )
      .innerJoin(users, eq(connectionRequests.receiverId, users.id));

    const requests = result.map(({ request, receiver }) => ({
      ...request,
      receiver,
    }));
    const visibleRequests = [];
    for (const request of requests) {
      const [blockedBySender, blockedByReceiver] = await Promise.all([
        this.isUserBlocked(userId, request.receiverId),
        this.isUserBlocked(request.receiverId, userId),
      ]);
      if (!blockedBySender && !blockedByReceiver) visibleRequests.push(request);
    }
    return visibleRequests;
  }

  async getOutgoingRequests(userId: number): Promise<(ConnectionRequest & { receiver: User })[]> {
    // Return pending sent requests as outgoing requests
    return this.getPendingRequestsSent(userId);
  }

  async acceptConnectionRequest(requestId: number, receiverId?: number): Promise<Connection | undefined> {
    const result = await db.transaction(async (tx) => {
      const conditions = [
        eq(connectionRequests.id, requestId),
        eq(connectionRequests.status, "requested"),
      ];
      if (receiverId !== undefined) {
        conditions.push(eq(connectionRequests.receiverId, receiverId));
      }

      const [request] = await tx
        .select()
        .from(connectionRequests)
        .where(and(...conditions))
        .for("update");

      if (!request) return undefined;

      const [smallerId, largerId] = [request.senderId, request.receiverId].sort((a, b) => a - b);
      let [connection] = await tx
        .insert(connections)
        .values({
          user1Id: smallerId,
          user2Id: largerId,
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .returning();

      if (!connection) {
        [connection] = await tx
          .select()
          .from(connections)
          .where(and(
            eq(connections.user1Id, smallerId),
            eq(connections.user2Id, largerId),
          ))
          .limit(1);
      }

      await tx
        .delete(connectionRequests)
        .where(eq(connectionRequests.id, requestId));

      await tx.insert(notifications).values([
        {
          userId: request.senderId,
          type: "new_connection",
          relatedId: connection.id,
          read: false,
          createdAt: new Date().toISOString(),
        },
        {
          userId: request.receiverId,
          type: "new_connection",
          relatedId: connection.id,
          read: false,
          createdAt: new Date().toISOString(),
        },
      ]).onConflictDoNothing();

      await tx.insert(deliveryObligations).values({
        userId: request.senderId,
        eventType: 'connectionAccepted',
        payload: JSON.stringify({ acceptedById: request.receiverId, requestId }),
        dedupeKey: `connection-accepted:${requestId}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: 'pending',
      }).onConflictDoNothing();

      return { connection, request };
    });

    if (!result) return undefined;
    const { connection, request } = result;
      
    // Clear synergy matches for both users to ensure connected users don't appear in matches
    try {
      await this.clearSynergyMatchesForUser(request.senderId);
      await this.clearSynergyMatchesForUser(request.receiverId);
      logger.debug(`Cleared synergy matches for users ${request.senderId} and ${request.receiverId} after connection`);
    } catch (error) {
      logger.error(`Error clearing synergy matches after connection: ${error}`);
      // Don't throw here - we still want to return the successful connection
    }
    
    return connection;
  }

  async rejectConnectionRequest(requestId: number, receiverId?: number): Promise<boolean> {
    const conditions = [
      eq(connectionRequests.id, requestId),
      eq(connectionRequests.status, "requested"),
    ];
    if (receiverId !== undefined) {
      conditions.push(eq(connectionRequests.receiverId, receiverId));
    }

    return db.transaction(async (tx) => {
      const deleted = await tx
        .delete(connectionRequests)
        .where(and(...conditions))
        .returning({ id: connectionRequests.id, receiverId: connectionRequests.receiverId });
      if (deleted.length === 0) return false;

      await tx
        .update(notifications)
        .set({ read: true })
        .where(and(
          eq(notifications.userId, deleted[0].receiverId),
          eq(notifications.type, "connection_request"),
          eq(notifications.relatedId, requestId),
        ));
      return true;
    });
  }

  async getConnections(userId: number): Promise<(Connection & { otherUser: User, isNew?: boolean })[]> {
    logger.debug(`[Storage] Getting connections for user ${userId}`);
    
    // Get all connections for the user
    const userConnections = await db
      .select()
      .from(connections)
      .where(
        or(
          eq(connections.user1Id, userId),
          eq(connections.user2Id, userId)
        )
      )
      .orderBy(desc(connections.createdAt));

    // Get all unread new connection notifications to mark which connections are new
    const unreadNotifications = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, "new_connection"),
          eq(notifications.read, false)
        )
      );
    
    logger.debug(`[Storage] Found ${unreadNotifications.length} unread new connection notifications`);
    
    // Create a set of connection IDs that have unread notifications
    const newConnectionIds = new Set(unreadNotifications.map(n => n.relatedId));
    
    const result = [];
    for (const conn of userConnections) {
      const otherUserId = conn.user1Id === userId ? conn.user2Id : conn.user1Id;
      const [blockedByViewer, blockedByOther] = await Promise.all([
        this.isUserBlocked(userId, otherUserId),
        this.isUserBlocked(otherUserId, userId),
      ]);
      if (blockedByViewer || blockedByOther) continue;

      const [otherUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, otherUserId));

      if (otherUser) {
        // Check if this connection is new (has an unread notification)
        const isNew = newConnectionIds.has(conn.id);
        
        result.push({
          ...conn,
          otherUser,
          isNew  // Add the isNew flag
        });
      }
    }

    logger.debug(`[Storage] Returning ${result.length} connections for user ${userId}`);
    return result;
  }

  async deleteConnection(userId: number, otherUserId: number): Promise<void> {
    try {
      logger.debug(`[deleteConnection] Deleting connection between users ${userId} and ${otherUserId}`);
      
      // First, get the connection ID before deleting (needed for notification cleanup)
      const [connectionToDelete] = await db
        .select()
        .from(connections)
        .where(
          or(
            and(
              eq(connections.user1Id, userId),
              eq(connections.user2Id, otherUserId)
            ),
            and(
              eq(connections.user1Id, otherUserId),
              eq(connections.user2Id, userId)
            )
          )
        );
      
      const connectionId = connectionToDelete?.id;
      
      // Delete the connection
      await db
        .delete(connections)
        .where(
          or(
            and(
              eq(connections.user1Id, userId),
              eq(connections.user2Id, otherUserId)
            ),
            and(
              eq(connections.user1Id, otherUserId),
              eq(connections.user2Id, userId)
            )
          )
        );
      
      // Also delete any conversations
      const [smallerId, largerId] = [userId, otherUserId].sort((a, b) => a - b);
      await db
        .delete(conversations)
        .where(
          and(
            eq(conversations.user1Id, smallerId),
            eq(conversations.user2Id, largerId)
          )
        );
      
      // Clean up notifications for both users related to this connection
      // Get all messages between these users and mark related notifications as read
      const messagesBetweenUsers = await db
        .select()
        .from(messages)
        .where(
          or(
            and(eq(messages.senderId, userId), eq(messages.receiverId, otherUserId)),
            and(eq(messages.senderId, otherUserId), eq(messages.receiverId, userId))
          )
        );
      
      const messageIds = messagesBetweenUsers.map(m => m.id);
      
      if (messageIds.length > 0) {
        // Mark all message notifications from this conversation as read for both users only
        await db
          .update(notifications)
          .set({ read: true })
          .where(
            and(
              eq(notifications.type, 'message'),
              or(
                eq(notifications.userId, userId),
                eq(notifications.userId, otherUserId)
              ),
              sql`${notifications.relatedId} IN (${sql.join(messageIds.map(id => sql`${id}`), sql`, `)})`
            )
          );
        logger.debug(`[deleteConnection] Marked message notifications for users ${userId} and ${otherUserId} as read`);
      }
      
      // Mark the specific new_connection notification as read for both users (only for this connection)
      if (connectionId) {
        await db
          .update(notifications)
          .set({ read: true })
          .where(
            and(
              eq(notifications.type, 'new_connection'),
              eq(notifications.read, false),
              eq(notifications.relatedId, connectionId)
            )
          );
        logger.debug(`[deleteConnection] Marked new_connection notification for connection ${connectionId} as read`);
      }
      
      logger.debug(`[deleteConnection] Successfully deleted connection between users ${userId} and ${otherUserId}`);
    } catch (error) {
      logger.error(`[deleteConnection] Error deleting connection between users ${userId} and ${otherUserId}:`, error);
      throw error;
    }
  }

  async getConnectionBetweenUsers(userId: number, connectedUserId: number): Promise<Connection | undefined> {
    try {
        if (!userId || !connectedUserId) {
            logger.debug(`[Storage] Missing user IDs for connection check: ${userId}, ${connectedUserId}`);
            return undefined;
        }

        logger.debug(`[Storage] Checking connection between users ${userId} and ${connectedUserId}`);
        const [connection] = await db
            .select()
            .from(connections)
            .where(
                or(
                    and(
                        eq(connections.user1Id, userId),
                        eq(connections.user2Id, connectedUserId)
                    ),
                    and(
                        eq(connections.user1Id, connectedUserId),
                        eq(connections.user2Id, userId)
                    )
                )
            );

        logger.debug(`[Storage] Connection found:`, connection);
        return connection;
    } catch (error) {
        logger.error('[Storage] Error checking connection:', error);
        throw error;
    }
}

  async createMessage(message: { senderId: number; receiverId: number; content: string; }): Promise<Message & { sender: User, receiver: User }> {
    try {
      return await db.transaction(async (tx) => {
        const [connection] = await tx
          .select({ id: connections.id })
          .from(connections)
          .where(or(
            and(eq(connections.user1Id, message.senderId), eq(connections.user2Id, message.receiverId)),
            and(eq(connections.user1Id, message.receiverId), eq(connections.user2Id, message.senderId)),
          ))
          .limit(1);
        if (!connection) throw new Error("Users are not connected");

        const [smallerId, largerId] = [message.senderId, message.receiverId].sort((a, b) => a - b);
        let [conversation] = await tx
          .insert(conversations)
          .values({
            user1Id: smallerId,
            user2Id: largerId,
            isGroup: false,
            createdAt: new Date().toISOString(),
            lastMessageAt: new Date().toISOString(),
          })
          .onConflictDoNothing()
          .returning();
        if (!conversation) {
          [conversation] = await tx
            .select()
            .from(conversations)
            .where(and(
              eq(conversations.user1Id, smallerId),
              eq(conversations.user2Id, largerId),
              or(eq(conversations.isGroup, false), isNull(conversations.isGroup)),
            ))
            .limit(1);
        }
        if (!conversation) throw new Error("Failed to create conversation");

        const [newMessage] = await tx
          .insert(messages)
          .values({
            senderId: message.senderId,
            receiverId: message.receiverId,
            content: message.content,
            conversationId: conversation.id,
            createdAt: new Date().toISOString(),
          })
          .returning();

        await tx
          .update(conversations)
          .set({ lastMessageAt: new Date().toISOString() })
          .where(eq(conversations.id, conversation.id));

        const [[sender], [receiver]] = await Promise.all([
          tx.select().from(users).where(eq(users.id, message.senderId)),
          tx.select().from(users).where(eq(users.id, message.receiverId)),
        ]);
        if (!sender || !receiver) throw new Error("Could not find sender or receiver");

        await tx.insert(notifications).values({
          userId: message.receiverId,
          type: "message",
          relatedId: newMessage.id,
          read: false,
          createdAt: new Date().toISOString(),
        }).onConflictDoNothing();

        return { ...newMessage, sender, receiver };
      });
    } catch (error) {
      logger.error('Error in createMessage:', error);
      throw error;
    }
  }

  async getMessages(user1Id: number, user2Id: number): Promise<(Message & { sender: User, receiver: User })[]> {
    const page = await this.getMessagesPage(user1Id, user2Id, { limit: DEFAULT_MESSAGE_PAGE_SIZE });
    return page.items;
  }

  async getMessagesPage(
    user1Id: number,
    user2Id: number,
    options: { limit?: number; cursor?: MessageCursor } = {},
  ): Promise<{
    items: (Message & { sender: User, receiver: User })[];
    nextCursor?: string;
  }> {
    try {
      // Input validation
      if (!user1Id || !user2Id || isNaN(user1Id) || isNaN(user2Id)) {
        logger.error('[Storage] Invalid user IDs:', { user1Id, user2Id });
        throw new Error('Invalid user IDs provided');
      }

      // First, check if the two users are connected (has a relationship in connections table)
      const connection = await this.getConnectionBetweenUsers(user1Id, user2Id);
      
      if (!connection) {
        logger.debug(`[Storage] No connection found between users ${user1Id} and ${user2Id}`);
        throw new Error('Users are not connected');
      }

      // Get conversation (create if it doesn't exist)
      logger.debug(`[Storage] Finding or creating conversation between users ${user1Id} and ${user2Id}`);
      const conversation = await this.getOrCreateConversation(user1Id, user2Id);
      
      if (!conversation) {
        logger.error(`[Storage] Failed to get or create conversation between users ${user1Id} and ${user2Id}`);
        throw new Error('Failed to get or create conversation');
      }

      logger.debug(`[Storage] Found conversation ${conversation.id}, fetching messages...`);

      const requestedLimit = options.limit ?? DEFAULT_MESSAGE_PAGE_SIZE;
      const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_MESSAGE_PAGE_SIZE);
      const cursor = options.cursor;
      const cursorCondition = cursor
        ? or(
            gt(messages.createdAt, cursor.createdAt),
            and(eq(messages.createdAt, cursor.createdAt), gt(messages.id, cursor.id)),
          )
        : undefined;

      const messagesList = await db
        .select()
        .from(messages)
        .where(cursorCondition
          ? and(eq(messages.conversationId, conversation.id), cursorCondition)
          : eq(messages.conversationId, conversation.id))
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .limit(limit + 1);

      // If no messages, return empty array
      if (messagesList.length === 0) {
        logger.debug(`[Storage] No messages found in conversation ${conversation.id}`);
        return { items: [] };
      }

      logger.debug(`[Storage] Found ${messagesList.length} messages in conversation ${conversation.id}`);
      const hasMore = messagesList.length > limit;
      const pageMessages = hasMore ? messagesList.slice(0, limit) : messagesList;
      const userIds = [...new Set(pageMessages.flatMap((message) => [message.senderId, message.receiverId]))];
      const participantRows = await db.select().from(users).where(inArray(users.id, userIds));
      const participants = new Map(participantRows.map((participant) => [participant.id, participant]));

      const messagesWithUsers = pageMessages.map((message) => ({
        ...message,
        sender: participants.get(message.senderId)!,
        receiver: participants.get(message.receiverId)!,
      }));

      return {
        items: messagesWithUsers,
        ...(hasMore ? { nextCursor: Buffer.from(JSON.stringify({
          id: pageMessages[pageMessages.length - 1].id,
          createdAt: pageMessages[pageMessages.length - 1].createdAt,
        }), 'utf8').toString('base64url') } : {}),
      };

    } catch (error) {
      logger.error('[Storage] Error fetching messages:', error);
      throw error;
    }
  }

  async getAllPotentialConnections(userId: number, page = 1, perPage = 10, searchParams?: Partial<User>): Promise<{ profiles: User[], hasMore: boolean }> {
    try {
      // Get IDs of users who are already connected or have pending requests
      const existingConnections = await db
        .select()
        .from(connections)
        .where(
          or(
            eq(connections.user1Id, userId),
            eq(connections.user2Id, userId)
          )
        );

      // Get blocked user IDs - both users blocked by this user and users who have blocked this user
      const blockedByUserResult = await db
        .select()
        .from(userBlocks)
        .where(eq(userBlocks.userId, userId));
      
      const blockedByOthersResult = await db
        .select()
        .from(userBlocks)
        .where(eq(userBlocks.blockedUserId, userId));
        
      const blockedUserIds = blockedByUserResult.map(block => block.blockedUserId);
      const blockedByUserIds = blockedByOthersResult.map(block => block.userId);
      
      logger.debug(`[getAllPotentialConnections] Excluding ${blockedUserIds.length} users blocked by user ${userId}`);
      logger.debug(`[getAllPotentialConnections] Excluding ${blockedByUserIds.length} users who blocked user ${userId}`);

      const excludeUserIds = Array.from(new Set([
        ...existingConnections.map(conn => conn.user1Id),
        ...existingConnections.map(conn => conn.user2Id),
        ...blockedUserIds,
        ...blockedByUserIds,
        userId // exclude self
      ]));

      // Calculate offset based on page and perPage
      const offset = (page - 1) * perPage;

      // Build the where conditions
      const conditions = [];
      
      // Base condition - exclude users who are already connected and blocked users
      conditions.push(not(inArray(users.id, excludeUserIds)));
      conditions.push(discoverableUserCondition());
      
      // Add name search if provided
      if (searchParams?.fullName && searchParams.fullName.trim() !== '') {
        const nameSearchPattern = `%${searchParams.fullName}%`;
        conditions.push(ilike(users.fullName, nameSearchPattern));
      }

      // Apply other search filters if provided
      if (searchParams?.industry && searchParams.industry.trim() !== '') {
        conditions.push(eq(users.industry, searchParams.industry));
      }
      
      if (searchParams?.currentLocation && searchParams.currentLocation.trim() !== '') {
        const locationPattern = `%${searchParams.currentLocation}%`;
        conditions.push(ilike(users.currentLocation, locationPattern));
      }
      
      if (searchParams?.currentCompany && searchParams.currentCompany.trim() !== '') {
        const companyPattern = `%${searchParams.currentCompany}%`;
        conditions.push(ilike(users.currentCompany, companyPattern));
      }
      
      if (searchParams?.title && searchParams.title.trim() !== '') {
        const titlePattern = `%${searchParams.title}%`;
        conditions.push(ilike(users.title, titlePattern));
      }
      
      // Create the final where condition
      const whereCondition = and(...conditions);
      
      // Get total count for hasMore calculation
      const [{ count }] = await db
        .select({
          count: sql<number>`cast(count(*) as integer)`
        })
        .from(users)
        .where(whereCondition);
      
      // Get paginated results
      const potentialConnections = await db
        .select()
        .from(users)
        .where(whereCondition)
        .limit(perPage)
        .offset(offset);

      return {
        profiles: potentialConnections,
        hasMore: offset + potentialConnections.length < count
      };
    } catch (error) {
      logger.error('Error getting potential connections:', error);
      throw error;
    }
  }

  async getAllUsers(): Promise<User[]> {
    try {
      const allUsers = await db.select().from(users);
      return allUsers;
    } catch (error) {
      logger.error('Error getting all users:', error);
      throw error;
    }
  }

  async getMatchingSynergies(userId: number): Promise<(User & { matchDescription?: string | null; matchScore?: number | null; matchReasons?: string[] })[]> {
    try {
      logger.debug(`[getMatchingSynergies] Getting saved matches for user ${userId}`);
      
      const existingSavedMatches = await this.getSavedSynergyMatches(userId);
      logger.debug(`[getMatchingSynergies] Found ${existingSavedMatches.length} saved matches for user ${userId}`);
      
      return existingSavedMatches.map(match => ({
        ...match.matchedUser,
        matchDescription: match.description,
        matchScore: match.score,
        matchReasons: match.matchReasons || [],
      }));
    } catch (error) {
      logger.error('[getMatchingSynergies] Error getting synergy matches:', error);
      throw error;
    }
  }

  async generateMatchesForUser(userId: number): Promise<(User & { matchDescription?: string | null; matchScore?: number | null; matchReasons?: string[] })[]> {
    try {
      logger.debug(`[generateMatchesForUser] Starting match generation for user ${userId}`);
      const currentUser = await this.getUser(userId);
      if (!currentUser) throw new Error("User not found");

      // Get IDs of users who are already connected
      const connectedUserIds = (await this.getConnections(userId)).map(conn => conn.otherUser.id);
      logger.debug(`[generateMatchesForUser] Excluding ${connectedUserIds.length} connected users from synergy matches for user ${userId}`);

      // Get blocked user IDs - both users blocked by this user and users who have blocked this user
      const blockedByUserResult = await db
        .select()
        .from(userBlocks)
        .where(eq(userBlocks.userId, userId));
      
      const blockedByOthersResult = await db
        .select()
        .from(userBlocks)
        .where(eq(userBlocks.blockedUserId, userId));
        
      const blockedUserIds = blockedByUserResult.map(block => block.blockedUserId);
      const blockedByUserIds = blockedByOthersResult.map(block => block.userId);
      
      logger.debug(`[generateMatchesForUser] Excluding ${blockedUserIds.length} users blocked by user ${userId}`);
      logger.debug(`[generateMatchesForUser] Excluding ${blockedByUserIds.length} users who blocked user ${userId}`);
      
      // Combine all user IDs to exclude
      const excludeUserIds = [...connectedUserIds, ...blockedUserIds, ...blockedByUserIds];

      // Get all potential matches excluding connected users, blocked users, self, and users with same employer
      const potentialMatches = await db
        .select()
        .from(users)
        .where(
          and(
            not(eq(users.id, userId)),
            excludeUserIds.length > 0 ? not(inArray(users.id, excludeUserIds)) : sql`1=1`,
            matchableUserCondition(),
            // Filter out users with the same current employer (case-insensitive comparison)
            currentUser.currentCompany ? 
              sql`LOWER(${users.currentCompany}) != LOWER(${currentUser.currentCompany})` : 
              sql`1=1`
          )
        );

      logger.debug(`[generateMatchesForUser] Found ${potentialMatches.length} potential matches for user ${userId} (excluding same employer)`);

      // Create potential bidirectional pairs for unified matching
      void potentialMatches.map(targetUser => ({
        userA: currentUser,
        userB: targetUser
      }));

      // PERFORMANCE OPTIMIZED: Pre-cache all user locations in batch before matching
      const allUsers = [currentUser, ...potentialMatches];
      logger.debug(`[generateMatchesForUser] PERFORMANCE OPTIMIZATION: Pre-caching locations for ${allUsers.length} users`);
      await (await import('./services/optimized-location-matcher')).optimizedLocationMatcher.batchEnsureUserLocationsCached(allUsers);
      
      // NOTE: AI matching has been isolated to Worker VM for security
      // This method is deprecated - use background job queue instead
      logger.warn(`[generateMatchesForUser] DEPRECATED: Direct AI matching disabled. Use background job queue for match generation.`);
      interface GeneratedBidirectionalMatch {
        userAId: number;
        userBId: number;
        descriptionForUserA: string;
        descriptionForUserB: string;
        matchScore: number;
        matchReasons: string[];
      }
      const matchingResult: { matches: GeneratedBidirectionalMatch[]; costSavings: number } = { matches: [], costSavings: 0 };
      logger.debug(`[generateMatchesForUser] Skipped AI processing - isolated to Worker VM`);

      // Save these matches to database for future use (will replace any existing GENERATING matches)
      logger.debug(`[generateMatchesForUser] Saving generated bidirectional matches to database`);
      
      // Save all bidirectional matches to the database (both perspectives)
      const savedMatches = [];
      
      for (const match of matchingResult.matches) {
        const userA = allUsers.find(u => u.id === match.userAId);
        const userB = allUsers.find(u => u.id === match.userBId);
        if (!userA || !userB) {
          logger.warn(`[generateMatchesForUser] Skipping match with missing profile-version metadata`);
          continue;
        }
        // Save match for User A (current user) viewing User B
        try {
          await this.saveSynergyMatch({
            userId: match.userAId,
            matchedUserId: match.userBId,
            description: match.descriptionForUserA,
            score: match.matchScore,
            matchReasons: match.matchReasons,
            generationStatus: 'READY',
            apiCallsUsed: 0,
            userProfileVersion: userA.profileVersion,
            matchedUserProfileVersion: userB.profileVersion,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          
          // Add to return array if this is for the current user
          if (match.userAId === userId) {
            const targetUser = potentialMatches.find(u => u.id === match.userBId);
            if (targetUser) {
              savedMatches.push({
                ...targetUser,
                matchDescription: match.descriptionForUserA,
                matchScore: match.matchScore,
                matchReasons: match.matchReasons
              });
            }
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes("connected users")) {
            logger.debug(`[generateMatchesForUser] Skipping match between ${match.userAId} and ${match.userBId} - users are now connected`);
          } else {
            logger.error(`[generateMatchesForUser] Error saving match between ${match.userAId} and ${match.userBId}:`, error);
          }
        }
        
        // Save match for User B viewing User A
        try {
          await this.saveSynergyMatch({
            userId: match.userBId,
            matchedUserId: match.userAId,
            description: match.descriptionForUserB,
            score: match.matchScore,
            matchReasons: match.matchReasons,
            generationStatus: 'READY',
            apiCallsUsed: 0,
            userProfileVersion: userB.profileVersion,
            matchedUserProfileVersion: userA.profileVersion,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes("connected users")) {
            logger.debug(`[generateMatchesForUser] Skipping reverse match between ${match.userBId} and ${match.userAId} - users are now connected`);
          } else {
            logger.error(`[generateMatchesForUser] Error saving reverse match between ${match.userBId} and ${match.userAId}:`, error);
          }
        }
      }

      logger.debug(`[generateMatchesForUser] Successfully saved ${savedMatches.length} bidirectional matches for user ${userId}`);
      
      // Clean up any leftover GENERATING matches that weren't replaced with new READY matches
      try {
        await db
          .delete(synergyMatches)
          .where(
            and(
              eq(synergyMatches.userId, userId),
              eq(synergyMatches.generationStatus, 'GENERATING')
            )
          );
        logger.debug(`[generateMatchesForUser] Cleaned up leftover GENERATING matches for user ${userId}`);
      } catch (error) {
        logger.error(`[generateMatchesForUser] Error cleaning up GENERATING matches:`, error);
        // Don't throw - the new matches were saved successfully
      }
      
      // Broadcast match refresh to all users who got new matches (both sides of bidirectional matches)
      const usersToNotify = new Set<number>();
      for (const match of matchingResult.matches) {
        usersToNotify.add(match.userAId);
        usersToNotify.add(match.userBId);
      }
      
      // Remove current user since they will get updated via the API response
      usersToNotify.delete(userId);
      
      if (usersToNotify.size > 0) {
        logger.debug(`[generateMatchesForUser] Broadcasting match refresh to ${usersToNotify.size} users who received new matches`);
        try {
          await broadcastMatchRefreshToUsers(Array.from(usersToNotify));
        } catch (error) {
          logger.error('[generateMatchesForUser] Error broadcasting match refresh:', error);
          // Don't throw here - the matches were saved successfully
        }
      }
      
      return savedMatches;
    } catch (error) {
      logger.error('[generateMatchesForUser] Error generating matches:', error);
      throw error;
    }
  }
  
  async getSavedSynergyMatches(userId: number): Promise<(SynergyMatch & { matchedUser: User })[]> {
    try {
      logger.debug(`[getSavedSynergyMatches] Getting saved matches for user ${userId}`);
      
      // Get all connected user IDs first
      const connectedUserIds = (await this.getConnections(userId)).map(conn => conn.otherUser.id);
      logger.debug(`[getSavedSynergyMatches] Found ${connectedUserIds.length} connected users to exclude from saved matches`);
      
      // Get blocked user IDs - both users blocked by this user and users who have blocked this user
      const blockedByUserResult = await db
        .select()
        .from(userBlocks)
        .where(eq(userBlocks.userId, userId));
      
      const blockedByOthersResult = await db
        .select()
        .from(userBlocks)
        .where(eq(userBlocks.blockedUserId, userId));
        
      const blockedUserIds = blockedByUserResult.map(block => block.blockedUserId);
      const blockedByUserIds = blockedByOthersResult.map(block => block.userId);
      
      logger.debug(`[getSavedSynergyMatches] Excluding ${blockedUserIds.length} users blocked by user ${userId}`);
      logger.debug(`[getSavedSynergyMatches] Excluding ${blockedByUserIds.length} users who blocked user ${userId}`);
      
      // Combine all user IDs to exclude
      const excludeUserIds = [...connectedUserIds, ...blockedUserIds, ...blockedByUserIds];
      
      // Get current user profile version for staleness validation
      const currentUser = await this.getUser(userId);
      if (!currentUser) {
        return [];
      }
      const currentUserProfileVersion = currentUser.profileVersion;
      
      // Database-level filtering: only select READY matches with current profile versions
      const result = await db
        .select({
          match: synergyMatches,
          matchedUser: users
        })
        .from(synergyMatches)
        .where(
          and(
            eq(synergyMatches.userId, userId),
            // Hard constraint: only READY matches with current profile versions
            eq(synergyMatches.generationStatus, 'READY'),
            sql`${synergyMatches.description} IS NOT NULL`,
            eq(synergyMatches.userProfileVersion, currentUserProfileVersion),
            eq(synergyMatches.matchedUserProfileVersion, users.profileVersion),
            matchableUserCondition(),
            // If we have users to exclude, exclude them from matches
            excludeUserIds.length > 0 
              ? not(inArray(synergyMatches.matchedUserId, excludeUserIds)) 
              : sql`1=1`
          )
        )
        .innerJoin(users, eq(synergyMatches.matchedUserId, users.id))
        .orderBy(desc(synergyMatches.score), asc(synergyMatches.matchedUserId)); // Deterministic ordering: score DESC, then ID ASC

      const matches = result.map(({ match, matchedUser }) => ({
        ...match,
        matchedUser
      }));
      
      logger.debug(`[getSavedSynergyMatches] Found ${matches.length} current READY matches for user ${userId} (profile version ${currentUserProfileVersion})`);
      
      // Clean up any matches that are now connected
      if (connectedUserIds.length > 0) {
        logger.debug(`[getSavedSynergyMatches] Removing any synergy matches with connected users from database`);
        // Delete synergy matches with connected users in background without waiting
        for (const connectedId of connectedUserIds) {
          try {
            // Delete any synergy matches for the connected user
            await db
              .delete(synergyMatches)
              .where(
                and(
                  eq(synergyMatches.userId, userId),
                  eq(synergyMatches.matchedUserId, connectedId)
                )
              );
            
            logger.debug(`[getSavedSynergyMatches] Removed any matches with connected user ${connectedId}`);
          } catch (err) {
            logger.error(`[getSavedSynergyMatches] Error deleting match with connected user ${connectedId}:`, err);
          }
        }
      }
      
      return matches;
    } catch (error) {
      logger.error('[getSavedSynergyMatches] Error getting saved synergy matches:', error);
      return [];
    }
  }

  async saveSynergyMatch(match: InsertSynergyMatch): Promise<SynergyMatch> {
    try {
      logger.debug(`[saveSynergyMatch] Saving match between users ${match.userId} and ${match.matchedUserId}`);
      
      // First, check if these users are already connected
      const connection = await this.getConnectionBetweenUsers(match.userId, match.matchedUserId);
      if (connection) {
        logger.debug(`[saveSynergyMatch] Users ${match.userId} and ${match.matchedUserId} are already connected, skipping match`);
        throw new Error("Cannot save match between connected users");
      }
      
      // Check if either user has blocked the other
      const isBlocked = await this.isUserBlocked(match.userId, match.matchedUserId);
      const isBlockedBy = await this.isUserBlocked(match.matchedUserId, match.userId);
      
      if (isBlocked) {
        logger.debug(`[saveSynergyMatch] User ${match.userId} has blocked user ${match.matchedUserId}, skipping match`);
        throw new Error("Cannot save match when user has blocked the matched user");
      }
      
      if (isBlockedBy) {
        logger.debug(`[saveSynergyMatch] User ${match.matchedUserId} has blocked user ${match.userId}, skipping match`);
        throw new Error("Cannot save match when user is blocked by the matched user");
      }
      
      // Check if a match already exists
      const existingMatch = await db
        .select()
        .from(synergyMatches)
        .where(
          and(
            eq(synergyMatches.userId, match.userId),
            eq(synergyMatches.matchedUserId, match.matchedUserId)
          )
        );

      if (existingMatch.length > 0) {
        logger.debug(`[saveSynergyMatch] Match already exists, updating...`);
        // Update existing match
        const [updatedMatch] = await db
          .update(synergyMatches)
          .set({
            ...match,
            updatedAt: new Date().toISOString()
          })
          .where(eq(synergyMatches.id, existingMatch[0].id))
          .returning();
        
        return updatedMatch;
      } else {
        logger.debug(`[saveSynergyMatch] Creating new match`);
        // Create new match
        const [newMatch] = await db
          .insert(synergyMatches)
          .values(match)
          .returning();
        
        return newMatch;
      }
    } catch (error) {
      logger.error('[saveSynergyMatch] Error saving synergy match:', error);
      throw error;
    }
  }

  async claimSynergyMatchGeneration(
    match: InsertSynergyMatch & { generationJobKey: string }
  ): Promise<SynergyMatch | undefined> {
    const { userId, matchedUserId, generationJobKey, userProfileVersion, matchedUserProfileVersion } = match;
    const [created] = await db
      .insert(synergyMatches)
      .values(match)
      .onConflictDoNothing({
        target: [synergyMatches.userId, synergyMatches.matchedUserId]
      })
      .returning();

    if (created) return created;

    const [claimed] = await db
      .update(synergyMatches)
      .set({
        ...match,
        updatedAt: new Date().toISOString()
      })
      .where(and(
        eq(synergyMatches.userId, userId),
        eq(synergyMatches.matchedUserId, matchedUserId),
        sql`(
          ${synergyMatches.generationStatus} <> 'GENERATING'
          OR ${synergyMatches.generationJobKey} IS NULL
          OR ${synergyMatches.generationJobKey} = ${generationJobKey}
          OR ${synergyMatches.userProfileVersion} IS DISTINCT FROM ${userProfileVersion ?? null}
          OR ${synergyMatches.matchedUserProfileVersion} IS DISTINCT FROM ${matchedUserProfileVersion ?? null}
        )`
      ))
      .returning();

    return claimed;
  }

  async updateSynergyMatchForJob(
    id: number,
    generationJobKey: string,
    updates: Partial<Omit<SynergyMatch, 'id' | 'userId' | 'matchedUserId' | 'createdAt'>>
  ): Promise<boolean> {
    const updated = await db
      .update(synergyMatches)
      .set({
        ...updates,
        updatedAt: new Date().toISOString()
      })
      .where(and(
        eq(synergyMatches.id, id),
        eq(synergyMatches.generationJobKey, generationJobKey)
      ))
      .returning({ id: synergyMatches.id });

    return updated.length > 0;
  }

  async clearSynergyMatchesForUser(userId: number): Promise<void> {
    try {
      logger.debug(`[clearSynergyMatchesForUser] Clearing all synergy matches for user ${userId}`);
      await db
        .delete(synergyMatches)
        .where(eq(synergyMatches.userId, userId));
      
      logger.debug(`[clearSynergyMatchesForUser] Successfully cleared synergy matches for user ${userId}`);
    } catch (error) {
      logger.error('[clearSynergyMatchesForUser] Error clearing synergy matches:', error);
      throw error;
    }
  }

  async markMatchesAsGenerating(userId: number): Promise<number> {
    try {
      logger.debug(`[markMatchesAsGenerating] Marking all synergy matches as GENERATING for user ${userId}`);
      
      const result = await db
        .update(synergyMatches)
        .set({
          generationStatus: 'GENERATING',
          updatedAt: new Date().toISOString()
        })
        .where(eq(synergyMatches.userId, userId));
      
      const count = result.rowCount || 0;
      logger.debug(`[markMatchesAsGenerating] Marked ${count} matches as GENERATING for user ${userId}`);
      return count;
    } catch (error) {
      logger.error('[markMatchesAsGenerating] Error marking matches as generating:', error);
      throw error;
    }
  }

  async hasGeneratingMatches(userId: number): Promise<boolean> {
    try {
      const matches = await db
        .select({ id: synergyMatches.id })
        .from(synergyMatches)
        .where(
          and(
            eq(synergyMatches.userId, userId),
            eq(synergyMatches.generationStatus, 'GENERATING')
          )
        )
        .limit(1);
      
      return matches.length > 0;
    } catch (error) {
      logger.error('[hasGeneratingMatches] Error checking for generating matches:', error);
      return false;
    }
  }

  async checkPendingMatchJob(userId: number): Promise<boolean> {
    try {
      // Only check for HIGH-PRIORITY jobs (priority <= 5) to match worker's notification logic
      // This ensures frontend loading state clears when user-visible matches are ready,
      // even if low-priority background jobs are still processing
      const HIGH_PRIORITY_THRESHOLD = 5;
      
      const jobs = await db
        .select({ id: matchGenerationJobs.id })
        .from(matchGenerationJobs)
        .where(
          and(
            eq(matchGenerationJobs.userId, userId),
            inArray(matchGenerationJobs.status, ['PENDING', 'PROCESSING', 'RETRYING']),
            lte(matchGenerationJobs.priority, HIGH_PRIORITY_THRESHOLD)
          )
        )
        .limit(1);
      
      return jobs.length > 0;
    } catch (error) {
      logger.error('[checkPendingMatchJob] Error checking for pending jobs:', error);
      return false;
    }
  }

  async hasCompletedMatchGeneration(userId: number): Promise<boolean> {
    try {
      // Check if user has ever had a COMPLETED MATCH_DESCRIPTION job
      // This helps differentiate between "never generated" vs "generated with 0 results"
      // CRITICAL: Must filter by jobType='MATCH_DESCRIPTION' to avoid counting unrelated jobs
      const completedJobs = await db
        .select({ id: matchGenerationJobs.id })
        .from(matchGenerationJobs)
        .where(
          and(
            eq(matchGenerationJobs.userId, userId),
            eq(matchGenerationJobs.status, 'COMPLETED'),
            eq(matchGenerationJobs.jobType, 'MATCH_DESCRIPTION')
          )
        )
        .limit(1);
      
      return completedJobs.length > 0;
    } catch (error) {
      logger.error('[hasCompletedMatchGeneration] Error checking for completed jobs:', error);
      return false;
    }
  }

  async getSynergyMatchById(id: number): Promise<SynergyMatch | null> {
    try {
      logger.debug(`[getSynergyMatchById] Getting synergy match by ID: ${id}`);
      
      const [match] = await db
        .select()
        .from(synergyMatches)
        .where(eq(synergyMatches.id, id));
      
      if (!match) {
        logger.debug(`[getSynergyMatchById] No match found with ID: ${id}`);
        return null;
      }
      
      logger.debug(`[getSynergyMatchById] Found match between users ${match.userId} and ${match.matchedUserId}`);
      return match;
    } catch (error) {
      logger.error('[getSynergyMatchById] Error getting synergy match by ID:', error);
      return null;
    }
  }

  async updateSynergyMatchById(id: number, updates: Partial<Omit<SynergyMatch, 'id' | 'userId' | 'matchedUserId' | 'createdAt'>>): Promise<void> {
    try {
      logger.debug(`[updateSynergyMatchById] Updating synergy match ID: ${id}`);
      
      await db
        .update(synergyMatches)
        .set({
          ...updates,
          updatedAt: new Date().toISOString()
        })
        .where(eq(synergyMatches.id, id));
      
      logger.debug(`[updateSynergyMatchById] Successfully updated synergy match ID: ${id}`);
    } catch (error) {
      logger.error('[updateSynergyMatchById] Error updating synergy match:', error);
      throw error;
    }
  }

  async findUsersMatchingWithUser(userId: number): Promise<number[]> {
    try {
      logger.debug(`[findUsersMatchingWithUser] Finding users that have matched with user ${userId}`);
      
      // Find all users who have this user as a match in their synergy matches
      const matchingUsers = await db
        .select({ userId: synergyMatches.userId })
        .from(synergyMatches)
        .where(eq(synergyMatches.matchedUserId, userId));
      
      const userIds = matchingUsers.map(match => match.userId);
      logger.debug(`[findUsersMatchingWithUser] Found ${userIds.length} users that have user ${userId} in their matches`);
      
      return userIds;
    } catch (error) {
      logger.error('[findUsersMatchingWithUser] Error finding matching users:', error);
      return [];
    }
  }

  async findPotentialMatchUserIds(userId: number): Promise<number[]> {
    try {
      const viewingUser = await this.getUser(userId);
      if (
        !viewingUser ||
        !viewingUser.emailVerified ||
        !viewingUser.registrationCompleted ||
        !viewingUser.hasMinimumMatchData
      ) {
        return [];
      }

      const existingConnections = await db
        .select()
        .from(connections)
        .where(or(eq(connections.user1Id, userId), eq(connections.user2Id, userId)));
      const blockedByUser = await db
        .select()
        .from(userBlocks)
        .where(eq(userBlocks.userId, userId));
      const blockedByOthers = await db
        .select()
        .from(userBlocks)
        .where(eq(userBlocks.blockedUserId, userId));
      const excludedUserIds = Array.from(new Set([
        userId,
        ...existingConnections.flatMap((connection) => [connection.user1Id, connection.user2Id]),
        ...blockedByUser.map((block) => block.blockedUserId),
        ...blockedByOthers.map((block) => block.userId),
      ]));

      const conditions = [
        matchableUserCondition(),
        not(inArray(users.id, excludedUserIds)),
      ];
      if (viewingUser.currentCompany) {
        conditions.push(sql`LOWER(${users.currentCompany}) != LOWER(${viewingUser.currentCompany})`);
      }

      const potentialUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(...conditions))
        .orderBy(asc(users.id));

      return potentialUsers.map(({ id }) => id);
    } catch (error) {
      logger.error('[findPotentialMatchUserIds] Error finding eligible match candidates:', error);
      return [];
    }
  }

  async getOrCreateConversation(user1Id: number, user2Id: number): Promise<Conversation> {
    try {
      return await db.transaction(async (tx) => {
        const [connection] = await tx
          .select({ id: connections.id })
          .from(connections)
          .where(or(
            and(eq(connections.user1Id, user1Id), eq(connections.user2Id, user2Id)),
            and(eq(connections.user1Id, user2Id), eq(connections.user2Id, user1Id)),
          ))
          .limit(1);
        if (!connection) throw new Error("Users are not connected");

        const [smallerId, largerId] = [user1Id, user2Id].sort((a, b) => a - b);
        let [conversation] = await tx
          .insert(conversations)
          .values({
            user1Id: smallerId,
            user2Id: largerId,
            isGroup: false,
            createdAt: new Date().toISOString(),
            lastMessageAt: new Date().toISOString(),
          })
          .onConflictDoNothing()
          .returning();
        if (!conversation) {
          [conversation] = await tx
            .select()
            .from(conversations)
            .where(and(
              eq(conversations.user1Id, smallerId),
              eq(conversations.user2Id, largerId),
              or(eq(conversations.isGroup, false), isNull(conversations.isGroup)),
            ))
            .orderBy(desc(conversations.lastMessageAt))
            .limit(1);
        }
        if (!conversation) throw new Error("Failed to create conversation");
        return conversation;
      });
    } catch (error) {
      logger.error('[Storage] Error in getOrCreateConversation:', error);
      throw error;
    }
  }

  async getConversationById(conversationId: number): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.id, conversationId),
        or(eq(conversations.isGroup, false), isNull(conversations.isGroup)),
      ));
    return conversation;
  }

  async getUserConversations(userId: number): Promise<(Conversation & { otherUser: User, lastMessage?: Message, hasUnreadMessages?: boolean })[]> {
    try {
      logger.debug('Fetching conversations for user:', userId);
      
      // Get all conversations where the user is either user1 or user2
      const userConversations = await db.select()
        .from(conversations)
        .where(
          and(
            or(
              eq(conversations.user1Id, userId),
              eq(conversations.user2Id, userId)
            ),
            or(eq(conversations.isGroup, false), isNull(conversations.isGroup)),
          )
        )
        .orderBy(desc(conversations.lastMessageAt));

      logger.debug(`Found ${userConversations.length} conversations for user ${userId}:`,
        userConversations.map(c => ({
          id: c.id,
          user1Id: c.user1Id,
          user2Id: c.user2Id,
          lastMessageAt: c.lastMessageAt
        }))
      );
      
      // Track seen conversation partners to prevent duplicate conversations
      const seenPartnerIds = new Set<number>();

      const result = [];
      for (const conv of userConversations) {
        // For each conversation, get the other user's details
        const otherUserId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;
        
        // Skip this conversation if we've already seen this partner
        // This prevents duplicate conversations with the same user from appearing
        if (seenPartnerIds.has(otherUserId)) {
          logger.debug(`Skipping duplicate conversation ${conv.id} with user ${otherUserId} (already processed a conversation with this user)`);
          continue;
        }
        
        // Add this partner to the seen set
        seenPartnerIds.add(otherUserId);
        
        logger.debug(`Getting other user ${otherUserId} for conversation ${conv.id}`);

        const [otherUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, otherUserId));

        if (!otherUser) {
          logger.debug(`Warning: Could not find other user ${otherUserId} for conversation ${conv.id}`);
          continue;
        }

        // Get all messages for this conversation to show preview
        const [lastMessage] = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conv.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        // Check if there are unread messages for this conversation
        let hasUnreadMessages = false;
        
        if (lastMessage) {
          // Get message IDs for this conversation
          const messageIds = await db
            .select({ id: messages.id })
            .from(messages)
            .where(eq(messages.conversationId, conv.id));
          
          // Check if there are unread notifications for these messages
          if (messageIds.length > 0) {
            const unreadNotifications = await db
              .select()
              .from(notifications)
              .where(
                and(
                  eq(notifications.userId, userId),
                  eq(notifications.type, "message"),
                  eq(notifications.read, false),
                  inArray(
                    notifications.relatedId, 
                    messageIds.map(m => m.id)
                  )
                )
              );
            
            hasUnreadMessages = unreadNotifications.length > 0;
          }
        }

        const conversation = {
          ...conv,
          otherUser,
          lastMessage,
          hasUnreadMessages
        };

        logger.debug('Adding conversation:', {
          id: conversation.id,
          otherUser: {
            id: conversation.otherUser.id,
            fullName: conversation.otherUser.fullName
          },
          lastMessage: lastMessage ? {
            id: lastMessage.id,
            content: lastMessage.content,
            createdAt: lastMessage.createdAt
          } : undefined,
          hasUnreadMessages
        });

        result.push(conversation);
      }

      logger.debug(`Returning ${result.length} conversations for user ${userId}`);
      return result;
    } catch (error) {
      logger.error('Error in getUserConversations:', error);
      throw error;
    }
  }

  async searchConversationMessages(userId: number, searchQuery: string): Promise<(Conversation & { otherUser: User, lastMessage?: Message, hasUnreadMessages?: boolean })[]> {
    try {
      logger.debug(`[Storage] Searching conversations for user ${userId} with query: "${searchQuery}"`);
      
      // Get all conversations for the user
      const userConversations = await db.select()
        .from(conversations)
        .where(
          and(
            or(
              eq(conversations.user1Id, userId),
              eq(conversations.user2Id, userId)
            ),
            or(eq(conversations.isGroup, false), isNull(conversations.isGroup)),
          )
        );

      logger.debug(`[Storage] Found ${userConversations.length} total conversations to search`);
      
      // Track seen conversation partners to prevent duplicates
      const seenPartnerIds = new Set<number>();
      const matchingConversations = [];

      for (const conv of userConversations) {
        const otherUserId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;
        
        // Skip duplicate conversations with the same user
        if (seenPartnerIds.has(otherUserId)) {
          continue;
        }
        seenPartnerIds.add(otherUserId);

        // Get the other user's details
        const [otherUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, otherUserId));

        if (!otherUser) {
          continue;
        }

        // Check if the user's name matches the search query
        const nameMatch = otherUser.fullName.toLowerCase().includes(searchQuery.toLowerCase());

        // Get all messages for this conversation and check if any match the search query
        const allMessages = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conv.id))
          .orderBy(desc(messages.createdAt));

        const messageMatch = allMessages.some(message => 
          message.content.toLowerCase().includes(searchQuery.toLowerCase())
        );

        // If either name or any message matches, include this conversation
        if (nameMatch || messageMatch) {
          // Choose which message to display: if there's a message match, show the most recent matching message; otherwise show the latest message
          let displayMessage;
          if (messageMatch) {
            // Find the most recent message that matches the search query
            // allMessages is already sorted by createdAt DESC, so find the first match
            displayMessage = allMessages.find(msg => 
              msg.content.toLowerCase().includes(searchQuery.toLowerCase())
            );
          }
          
          // If no specific message match, show the latest message
          if (!displayMessage) {
            displayMessage = allMessages.length > 0 ? allMessages[0] : undefined;
          }

          // Check for unread messages
          let hasUnreadMessages = false;
          if (allMessages.length > 0) {
            const messageIds = allMessages.map(m => m.id);
            
            const unreadNotifications = await db
              .select()
              .from(notifications)
              .where(
                and(
                  eq(notifications.userId, userId),
                  eq(notifications.type, "message"),
                  eq(notifications.read, false),
                  inArray(notifications.relatedId, messageIds)
                )
              );
            
            hasUnreadMessages = unreadNotifications.length > 0;
          }

          matchingConversations.push({
            ...conv,
            otherUser,
            lastMessage: displayMessage,
            hasUnreadMessages
          });

          logger.debug(`[Storage] Match found - Name: ${nameMatch}, Message: ${messageMatch}, User: ${otherUser.fullName}, Showing message: ${displayMessage?.content}`);
        }
      }

      // Sort by last message date, most recent first
      matchingConversations.sort((a, b) => {
        const aTime = a.lastMessageAt || a.createdAt;
        const bTime = b.lastMessageAt || b.createdAt;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      logger.debug(`[Storage] Returning ${matchingConversations.length} matching conversations`);
      return matchingConversations;
    } catch (error) {
      logger.error('[Storage] Error in searchConversationMessages:', error);
      throw error;
    }
  }

  async updateMessageStatus(messageId: number, userId: number, status: 'read' | 'delivered'): Promise<Message> {
    try {
      // Get the message
      const [message] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId));

      if (!message) {
        throw new Error('Message not found');
      }

      // Verify the user is the receiver of this message
      if (message.receiverId !== userId) {
        throw new Error('User is not authorized to update this message status');
      }

      // Update the message with new status
      const statusTimestamp = new Date().toISOString();
      const statusField = status === 'read' ? 'readAt' : 'deliveredAt';
      void statusTimestamp;
      void statusField;

      // For now, just return the message as we can't update it without schema changes
      // In a real implementation, we would add these fields to the messages table
      logger.debug(`Would update message ${messageId} with ${status} status for user ${userId}`);

      return message;
    } catch (error) {
      logger.error('Error updating message status:', error);
      throw error;
    }
  }
  async getUserById(userId: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    return user;
  }

  // Notification methods
  async createNotification(notification: InsertNotification): Promise<Notification> {
    try {
      const [newNotification] = await db
        .insert(notifications)
        .values(notification)
        .onConflictDoNothing()
        .returning();
      if (newNotification) return newNotification;
      const [existing] = await db.select().from(notifications).where(and(
        eq(notifications.userId, notification.userId),
        eq(notifications.type, notification.type),
        eq(notifications.relatedId, notification.relatedId),
      )).limit(1);
      if (!existing) throw new Error("Failed to create notification");
      return existing;
    } catch (error) {
      logger.error('[Storage] Error creating notification:', error);
      throw error;
    }
  }
  
  async getNotificationsForRelatedId(userId: number, relatedId: number, type: string): Promise<Notification[]> {
    try {
      logger.debug(`[Storage] Getting ${type} notifications for user ${userId} related to id ${relatedId}`);
      const relatedNotifications = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.type, type),
            eq(notifications.read, false),
            eq(notifications.relatedId, relatedId)
          )
        );
      
      logger.debug(`[Storage] Found ${relatedNotifications.length} notifications for ${type} with related id ${relatedId}`);
      return relatedNotifications;
    } catch (error) {
      logger.error(`[Storage] Error getting notifications for ${type} with related id ${relatedId}:`, error);
      throw error;
    }
  }

  async getUnreadNotifications(userId: number): Promise<Notification[]> {
    try {
      logger.debug(`[Storage] Getting unread notifications for user ${userId}`);
      const unreadNotifications = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.read, false)
          )
        )
        .orderBy(desc(notifications.createdAt));
        
      return unreadNotifications;
    } catch (error) {
      logger.error(`[Storage] Error getting unread notifications for user ${userId}:`, error);
      throw error;
    }
  }

  async getUnreadNotificationCounts(userId: number): Promise<{ messages: number, connectionRequests: number, newConnections: number }> {
    try {
      logger.debug(`[Storage] Getting unread notification counts for user ${userId}`);
      
      // Clean up stale connection request notifications first
      try {
        // Get all unread connection request notifications for this user
        const unreadConnectionRequestNotifications = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.type, 'connection_request'),
              eq(notifications.read, false),
              eq(notifications.userId, userId)
            )
          );
          
        // Get all pending connection requests
        const pendingRequests = await db
          .select()
          .from(connectionRequests)
          .where(
            and(
              eq(connectionRequests.status, 'requested'),
              eq(connectionRequests.receiverId, userId)
            )
          );
        
        logger.debug(`[Storage] Found ${pendingRequests.length} pending requests for user ${userId}`);
        
        // Create a Set of pending request IDs for fast lookup
        const pendingRequestIds = new Set(pendingRequests.map(r => r.id));
        
        // Find notifications with related IDs that aren't in the pending requests
        const staleNotifications = unreadConnectionRequestNotifications.filter(
          notification => !pendingRequestIds.has(notification.relatedId)
        );
        
        // Mark stale notifications as read
        for (const notification of staleNotifications) {
          await db
            .update(notifications)
            .set({ read: true })
            .where(eq(notifications.id, notification.id));
        }
        
        if (staleNotifications.length > 0) {
          logger.debug(`[Storage] Marked ${staleNotifications.length} stale connection request notifications as read`);
        }
        
        // Clean up stale new connection notifications (where the connection no longer exists)
        const unreadNewConnectionNotifications = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.type, 'new_connection'),
              eq(notifications.read, false),
              eq(notifications.userId, userId)
            )
          );
          
        // Get all user's connections
        const userConnections = await db
          .select()
          .from(connections)
          .where(
            or(
              eq(connections.user1Id, userId),
              eq(connections.user2Id, userId)
            )
          );
        
        // Create a Set of connection IDs for fast lookup
        const connectionIds = new Set(userConnections.map(c => c.id));
        
        // Find notifications with related IDs that aren't in the connections
        const staleConnectionNotifications = unreadNewConnectionNotifications.filter(
          notification => !connectionIds.has(notification.relatedId)
        );
        
        // Mark stale notifications as read
        for (const notification of staleConnectionNotifications) {
          await db
            .update(notifications)
            .set({ read: true })
            .where(eq(notifications.id, notification.id));
        }
        
        if (staleConnectionNotifications.length > 0) {
          logger.debug(`[Storage] Marked ${staleConnectionNotifications.length} stale new connection notifications as read`);
        }
        
        // Clean up stale message notifications (where sender is blocked, deleted, or no longer connected)
        const unreadMessageNotifications = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.type, 'message'),
              eq(notifications.read, false),
              eq(notifications.userId, userId)
            )
          );
        
        if (unreadMessageNotifications.length > 0) {
          // Get blocked users
          const blockedUsers = await db
            .select()
            .from(userBlocks)
            .where(eq(userBlocks.userId, userId));
          const blockedUserIds = new Set(blockedUsers.map(b => b.blockedUserId));
          
          // Get users who have blocked this user
          const blockedByUsers = await db
            .select()
            .from(userBlocks)
            .where(eq(userBlocks.blockedUserId, userId));
          const blockedByUserIds = new Set(blockedByUsers.map(b => b.userId));
          
          // Get all connected user IDs (use the userConnections we already fetched)
          const connectedUserIds = new Set<number>();
          for (const conn of userConnections) {
            const otherUserId = conn.user1Id === userId ? conn.user2Id : conn.user1Id;
            connectedUserIds.add(otherUserId);
          }
          
          // Get all message IDs from unread notifications to check senders
          const messageIdsToCheck = unreadMessageNotifications.map(n => n.relatedId);
          
          // Fetch those messages to get sender info
          const relevantMessages = messageIdsToCheck.length > 0 ? await db
            .select()
            .from(messages)
            .where(sql`${messages.id} IN (${sql.join(messageIdsToCheck.map(id => sql`${id}`), sql`, `)})`)
            : [];
          
          // Create a map of messageId -> senderId
          const messageToSender = new Map<number, number>();
          for (const msg of relevantMessages) {
            messageToSender.set(msg.id, msg.senderId);
          }
          
          // Find stale message notifications
          const staleMessageNotifications = unreadMessageNotifications.filter(notification => {
            const senderId = messageToSender.get(notification.relatedId);
            
            // If message doesn't exist, it's stale
            if (!senderId) return true;
            
            // If sender is blocked by this user, it's stale
            if (blockedUserIds.has(senderId)) return true;
            
            // If sender has blocked this user, it's stale
            if (blockedByUserIds.has(senderId)) return true;
            
            // If sender is no longer connected, it's stale
            if (!connectedUserIds.has(senderId)) return true;
            
            return false;
          });
          
          // Mark stale message notifications as read
          for (const notification of staleMessageNotifications) {
            await db
              .update(notifications)
              .set({ read: true })
              .where(eq(notifications.id, notification.id));
          }
          
          if (staleMessageNotifications.length > 0) {
            logger.debug(`[Storage] Marked ${staleMessageNotifications.length} stale message notifications as read`);
          }
        }
      } catch (cleanupError) {
        logger.error(`[Storage] Error cleaning up stale notifications: ${cleanupError}`);
        // Continue with getting counts even if cleanup fails
      }
      
      // DIRECT COUNT QUERY: Get counts directly from the database instead of loading all notifications
      // This ensures we get the most up-to-date counts after any changes
      
      // Count messages
      const [messageCount] = await db
        .select({ count: sql`count(*)` })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.type, 'message'),
            eq(notifications.read, false)
          )
        );
      
      // Count connection requests
      const [connectionRequestCount] = await db
        .select({ count: sql`count(*)` })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.type, 'connection_request'),
            eq(notifications.read, false)
          )
        );
      
      // Count new connections
      const [newConnectionCount] = await db
        .select({ count: sql`count(*)` })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.type, 'new_connection'),
            eq(notifications.read, false)
          )
        );
      
      const counts = {
        messages: Number(messageCount?.count || 0),
        connectionRequests: Number(connectionRequestCount?.count || 0),
        newConnections: Number(newConnectionCount?.count || 0)
      };
      
      logger.debug(`[Storage] Notification counts for user ${userId}:`, counts);
      
      return counts;
    } catch (error) {
      logger.error(`[Storage] Error getting unread notification counts for user ${userId}:`, error);
      throw error;
    }
  }

  async markNotificationAsRead(notificationId: number, userId: number): Promise<Notification | undefined> {
    try {
      logger.debug(`[Storage] Marking notification ${notificationId} as read for user ${userId}`);
      const [updatedNotification] = await db
        .update(notifications)
        .set({ read: true })
        .where(and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ))
        .returning();
      
      return updatedNotification;
    } catch (error) {
      logger.error(`[Storage] Error marking notification ${notificationId} as read:`, error);
      throw error;
    }
  }

  async markAllNotificationsAsRead(userId: number, type?: string): Promise<void> {
    try {
      logger.debug(`[Storage] Marking all notifications as read for user ${userId}${type ? ` of type ${type}` : ''}`);
      
      let conditions = and(
        eq(notifications.userId, userId),
        eq(notifications.read, false)
      );
      
      if (type) {
        conditions = and(conditions, eq(notifications.type, type));
      }
      
      await db
        .update(notifications)
        .set({ read: true })
        .where(conditions);
      
      logger.debug(`[Storage] Successfully marked notifications as read for user ${userId}`);
    } catch (error) {
      logger.error(`[Storage] Error marking notifications as read for user ${userId}:`, error);
      throw error;
    }
  }

  async markConversationNotificationsAsRead(userId: number, conversationId: number): Promise<void> {
    try {
      logger.debug(`[Storage] Marking message notifications as read for user ${userId} in conversation ${conversationId}`);
      
      // First, get all message IDs from this conversation
      const messagesInConversation = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId));
      
      if (messagesInConversation.length === 0) {
        logger.debug(`[Storage] No messages found in conversation ${conversationId}`);
        return;
      }
      
      // Extract all message IDs
      const messageIds = messagesInConversation.map(msg => msg.id);
      
      // Mark all notifications for these messages as read
      await db
        .update(notifications)
        .set({ read: true })
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.type, "message"),
            eq(notifications.read, false),
            inArray(notifications.relatedId, messageIds)
          )
        );
      
      logger.debug(`[Storage] Successfully marked message notifications as read for user ${userId} in conversation ${conversationId}`);
    } catch (error) {
      logger.error(`[Storage] Error marking conversation notifications as read for user ${userId}, conversation ${conversationId}:`, error);
      throw error;
    }
  }

  async markConnectionNotificationsAsRead(userId: number, connectionId: number): Promise<void> {
    try {
      logger.debug(`[Storage] Marking new connection notification as read for user ${userId}, connection ${connectionId}`);
      
      // Mark the specific new connection notification as read
      await db
        .update(notifications)
        .set({ read: true })
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.type, "new_connection"),
            eq(notifications.read, false),
            eq(notifications.relatedId, connectionId)
          )
        );
      
      logger.debug(`[Storage] Successfully marked new connection notification as read for user ${userId}, connection ${connectionId}`);
    } catch (error) {
      logger.error(`[Storage] Error marking connection notification as read for user ${userId}, connection ${connectionId}:`, error);
      throw error;
    }
  }

  // User block methods implementation
  async blockUser(userId: number, blockedUserId: number): Promise<UserBlock> {
    if (userId === blockedUserId) throw new Error("Cannot block yourself");
    return db.transaction(async (tx) => {
      let [block] = await tx
        .insert(userBlocks)
        .values({ userId, blockedUserId, createdAt: new Date().toISOString() })
        .onConflictDoNothing()
        .returning();
      if (!block) {
        [block] = await tx.select().from(userBlocks).where(and(
          eq(userBlocks.userId, userId),
          eq(userBlocks.blockedUserId, blockedUserId),
        )).limit(1);
      }

      await tx.delete(connections).where(or(
        and(eq(connections.user1Id, userId), eq(connections.user2Id, blockedUserId)),
        and(eq(connections.user1Id, blockedUserId), eq(connections.user2Id, userId)),
      ));
      await tx.delete(conversations).where(and(
        or(
          and(eq(conversations.user1Id, userId), eq(conversations.user2Id, blockedUserId)),
          and(eq(conversations.user1Id, blockedUserId), eq(conversations.user2Id, userId)),
        ),
        or(eq(conversations.isGroup, false), isNull(conversations.isGroup)),
      ));

      const requestRows = await tx.delete(connectionRequests).where(or(
        and(eq(connectionRequests.senderId, userId), eq(connectionRequests.receiverId, blockedUserId)),
        and(eq(connectionRequests.senderId, blockedUserId), eq(connectionRequests.receiverId, userId)),
      )).returning({ id: connectionRequests.id });
      const messageRows = await tx.select({ id: messages.id }).from(messages).where(and(
        eq(messages.senderId, blockedUserId),
        eq(messages.receiverId, userId),
      ));
      const requestIds = requestRows.map(({ id }) => id);
      const messageIds = messageRows.map(({ id }) => id);
      if (requestIds.length || messageIds.length) {
        await tx.update(notifications).set({ read: true }).where(and(
          eq(notifications.userId, userId),
          or(
            requestIds.length
              ? and(eq(notifications.type, "connection_request"), inArray(notifications.relatedId, requestIds))
              : sql`false`,
            messageIds.length
              ? and(eq(notifications.type, "message"), inArray(notifications.relatedId, messageIds))
              : sql`false`,
          ),
        ));
      }
      if (!block) throw new Error("Failed to create block");
      return block;
    });
  }

  async blockUserLegacy(userId: number, blockedUserId: number): Promise<UserBlock> {
    try {
      logger.debug(`[blockUser] Blocking user ${blockedUserId} by user ${userId}`);
      
      // First check if user is already blocked
      const existingBlock = await this.isUserBlocked(userId, blockedUserId);
      if (existingBlock) {
        logger.debug(`[blockUser] User ${blockedUserId} is already blocked by user ${userId}`);
        throw new Error("User is already blocked");
      }
      
      // Delete any existing connection between the users
      try {
        const connection = await this.getConnectionBetweenUsers(userId, blockedUserId);
        if (connection) {
          logger.debug(`[blockUser] Deleting existing connection before blocking`);
          await this.deleteConnection(userId, blockedUserId);
        }
      } catch (error) {
        logger.error(`[blockUser] Error checking/deleting connection:`, error);
        // Continue with blocking even if connection deletion fails
      }
      
      // Create the block
      const [block] = await db
        .insert(userBlocks)
        .values({
          userId,
          blockedUserId,
          createdAt: new Date().toISOString(),
        })
        .returning();
      
      // Clean up any remaining notifications from the blocked user
      // This includes connection_request notifications and any other notification types
      try {
        // Get all messages from the blocked user to this user
        const messagesFromBlockedUser = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.senderId, blockedUserId),
              eq(messages.receiverId, userId)
            )
          );
        
        const messageIds = messagesFromBlockedUser.map(m => m.id);
        
        if (messageIds.length > 0) {
          // Mark all message notifications from the blocked user as read
          await db
            .update(notifications)
            .set({ read: true })
            .where(
              and(
                eq(notifications.userId, userId),
                eq(notifications.type, 'message'),
                sql`${notifications.relatedId} IN (${sql.join(messageIds.map(id => sql`${id}`), sql`, `)})`
              )
            );
          logger.debug(`[blockUser] Marked ${messageIds.length} message notifications from blocked user as read`);
        }
        
        // Also mark any connection_request notifications from the blocked user as read
        // First find any pending connection requests from the blocked user
        const pendingRequestsFromBlockedUser = await db
          .select()
          .from(connectionRequests)
          .where(
            and(
              eq(connectionRequests.senderId, blockedUserId),
              eq(connectionRequests.receiverId, userId)
            )
          );
        
        const requestIds = pendingRequestsFromBlockedUser.map(r => r.id);
        
        if (requestIds.length > 0) {
          await db
            .update(notifications)
            .set({ read: true })
            .where(
              and(
                eq(notifications.userId, userId),
                eq(notifications.type, 'connection_request'),
                sql`${notifications.relatedId} IN (${sql.join(requestIds.map(id => sql`${id}`), sql`, `)})`
              )
            );
          logger.debug(`[blockUser] Marked ${requestIds.length} connection request notifications from blocked user as read`);
        }
      } catch (notificationError) {
        logger.error(`[blockUser] Error cleaning up notifications from blocked user:`, notificationError);
        // Continue even if notification cleanup fails
      }
      
      logger.debug(`[blockUser] Successfully blocked user ${blockedUserId} by user ${userId}`);
      return block;
    } catch (error) {
      logger.error(`[blockUser] Error blocking user ${blockedUserId} by user ${userId}:`, error);
      throw error;
    }
  }
  
  async unblockUser(userId: number, blockedUserId: number): Promise<void> {
    await db.delete(userBlocks).where(and(
      eq(userBlocks.userId, userId),
      eq(userBlocks.blockedUserId, blockedUserId),
    ));
  }

  async unblockUserLegacy(userId: number, blockedUserId: number): Promise<void> {
    try {
      logger.debug(`[unblockUser] Unblocking user ${blockedUserId} by user ${userId}`);
      
      await db
        .delete(userBlocks)
        .where(
          and(
            eq(userBlocks.userId, userId),
            eq(userBlocks.blockedUserId, blockedUserId)
          )
        );
      
      logger.debug(`[unblockUser] Successfully unblocked user ${blockedUserId} by user ${userId}`);
    } catch (error) {
      logger.error(`[unblockUser] Error unblocking user ${blockedUserId} by user ${userId}:`, error);
      throw error;
    }
  }
  
  async getBlockedUsers(userId: number): Promise<(UserBlock & { blockedUser: User })[]> {
    try {
      logger.debug(`[getBlockedUsers] Getting blocked users for user ${userId}`);
      
      // First check if there are any blocks in the database
      const allBlocks = await db
        .select()
        .from(userBlocks);
      logger.debug(`[getBlockedUsers] Total blocks in database: ${allBlocks.length}`, allBlocks);
      
      // Then check user's blocks specifically
      const userBlocksOnly = await db
        .select()
        .from(userBlocks)
        .where(eq(userBlocks.userId, userId));
      logger.debug(`[getBlockedUsers] User ${userId} has blocked ${userBlocksOnly.length} users:`, userBlocksOnly);
      
      // Get the full result with user details
      const result = await db
        .select({
          block: userBlocks,
          blockedUser: users,
        })
        .from(userBlocks)
        .where(eq(userBlocks.userId, userId))
        .innerJoin(users, eq(userBlocks.blockedUserId, users.id));
      
      logger.debug(`[getBlockedUsers] Found ${result.length} blocked users with details for user ${userId}`);
      
      const mappedResult = result.map(({ block, blockedUser }) => ({
        ...block,
        blockedUser,
      }));
      
      logger.debug(`[getBlockedUsers] Returning mapped result:`, mappedResult);
      
      return mappedResult;
    } catch (error) {
      logger.error(`[getBlockedUsers] Error getting blocked users for user ${userId}:`, error);
      throw error;
    }
  }
  
  async isUserBlocked(userId: number, blockedUserId: number): Promise<boolean> {
    try {
      logger.debug(`[isUserBlocked] Checking if user ${blockedUserId} is blocked by user ${userId}`);
      
      const [block] = await db
        .select()
        .from(userBlocks)
        .where(
          and(
            eq(userBlocks.userId, userId),
            eq(userBlocks.blockedUserId, blockedUserId)
          )
        );
      
      const isBlocked = !!block;
      logger.debug(`[isUserBlocked] User ${blockedUserId} is ${isBlocked ? '' : 'not '}blocked by user ${userId}`);
      
      return isBlocked;
    } catch (error) {
      logger.error(`[isUserBlocked] Error checking if user ${blockedUserId} is blocked by user ${userId}:`, error);
      throw error;
    }
  }

  // Background job management methods
  async createMatchGenerationJob(job: InsertMatchGenerationJob): Promise<MatchGenerationJob> {
    try {
      logger.debug(`[createMatchGenerationJob] Creating job for user ${job.userId}: ${job.jobType}`);
      
      const [newJob] = await db
        .insert(matchGenerationJobs)
        .values(job)
        .onConflictDoNothing({ target: matchGenerationJobs.idempotencyKey })
        .returning();

      if (!newJob) {
        const [existingJob] = await db
          .select()
          .from(matchGenerationJobs)
          .where(eq(matchGenerationJobs.idempotencyKey, job.idempotencyKey));
        if (!existingJob) {
          throw new Error(`Idempotent job ${job.idempotencyKey} was not found after conflict`);
        }
        logger.debug(`[createMatchGenerationJob] Reused existing job ${existingJob.id}`);
        return existingJob;
      }
      
      // Emit PostgreSQL NOTIFY to wake worker instantly (<1ms latency)
      try {
        const payload = JSON.stringify({
          id: newJob.id,
          priority: newJob.priority,
          jobType: newJob.jobType
        });
        // security-scanner-ignore: Using parameterized sql template literal - payload is safely passed as parameter
        await db.execute(sql`SELECT pg_notify('job_queued', ${payload})`);
        logger.debug(`[createMatchGenerationJob] ✅ Emitted job_queued NOTIFY for job ${newJob.id}`);
      } catch (notifyError) {
        // Log but don't fail - worker has 60s fallback polling
        logger.warn(`[createMatchGenerationJob] Failed to emit NOTIFY (worker will use fallback polling):`, notifyError);
      }
      
      logger.debug(`[createMatchGenerationJob] Created job ${newJob.id}`);
      return newJob;
    } catch (error) {
      logger.error(`[createMatchGenerationJob] Error creating job:`, error);
      throw error;
    }
  }

  async getMatchGenerationJob(jobId: number): Promise<MatchGenerationJob | undefined> {
    try {
      const [job] = await db
        .select()
        .from(matchGenerationJobs)
        .where(eq(matchGenerationJobs.id, jobId));
      
      return job;
    } catch (error) {
      logger.error(`[getMatchGenerationJob] Error getting job ${jobId}:`, error);
      throw error;
    }
  }

  async getPendingMatchGenerationJobs(limit: number): Promise<MatchGenerationJob[]> {
    try {
      const jobs = await db
        .select()
        .from(matchGenerationJobs)
        .where(or(
          eq(matchGenerationJobs.status, 'PENDING'),
          eq(matchGenerationJobs.status, 'RETRYING')
        ))
        .orderBy(
          asc(matchGenerationJobs.priority),
          asc(matchGenerationJobs.createdAt)
        )
        .limit(limit);
      
      return jobs;
    } catch (error) {
      logger.error(`[getPendingMatchGenerationJobs] Error getting pending jobs:`, error);
      throw error;
    }
  }

  async getPendingMatchGenerationJobsByPriority(limit: number, maxPriority: number): Promise<MatchGenerationJob[]> {
    try {
      const jobs = await db
        .select()
        .from(matchGenerationJobs)
        .where(and(
          or(
            eq(matchGenerationJobs.status, 'PENDING'),
            eq(matchGenerationJobs.status, 'RETRYING')
          ),
          sql`${matchGenerationJobs.priority} <= ${maxPriority}`
        ))
        .orderBy(
          asc(matchGenerationJobs.priority),
          asc(matchGenerationJobs.createdAt)
        )
        .limit(limit);
      
      return jobs;
    } catch (error) {
      logger.error(`[getPendingMatchGenerationJobsByPriority] Error getting pending jobs with maxPriority ${maxPriority}:`, error);
      throw error;
    }
  }

  async claimPendingJob(maxPriority?: number): Promise<MatchGenerationJob | null> {
    try {
      const now = new Date().toISOString();
      
      // Use raw SQL with FOR UPDATE SKIP LOCKED for atomic job claiming
      // This ensures only one worker can claim each job, preventing race conditions
      // OPTIMIZATION: Filter stale jobs at database level by joining with users table
      // to check profile versions BEFORE claiming, reducing wasted worker processing
      const query = `
        UPDATE match_generation_jobs
        SET status = 'PROCESSING', started_at = $1
        WHERE id = (
          SELECT j.id 
          FROM match_generation_jobs j
          INNER JOIN users u1 ON j.user_id = u1.id
          LEFT JOIN users u2 ON j.target_user_id = u2.id
          WHERE j.status IN ('PENDING', 'RETRYING')
          AND ($2::integer IS NULL OR j.priority <= $2)
          AND j.user_profile_version = u1.profile_version
          AND (
            j.target_user_id IS NULL
            OR (
              j.target_user_profile_version IS NOT NULL
              AND j.target_user_profile_version = u2.profile_version
            )
          )
          ORDER BY j.priority ASC, j.created_at ASC
          LIMIT 1
          FOR UPDATE OF j SKIP LOCKED
        )
        RETURNING *
      `;
      
      const params = [now, maxPriority ?? null];
      const result = await queryDatabase<{
        id: number;
        user_id: number;
        target_user_id: number | null;
        job_type: MatchGenerationJob['jobType'];
        status: MatchGenerationJob['status'];
        metadata: MatchGenerationJob['metadata'];
        priority: number;
        user_profile_version: number | null;
        target_user_profile_version: number | null;
        idempotency_key: string;
        user_snapshot_id: number | null;
        target_user_snapshot_id: number | null;
        created_at: string;
        started_at: string | null;
        completed_at: string | null;
        error_message: string | null;
        retry_count: number;
        max_retries: number;
      }>(pool, query, params);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      
      // Map database column names to camelCase for MatchGenerationJob type
      const job: MatchGenerationJob = {
        id: row.id,
        userId: row.user_id,
        targetUserId: row.target_user_id,
        jobType: row.job_type,
        status: row.status,
        metadata: row.metadata,
        priority: row.priority,
        userProfileVersion: row.user_profile_version,
        targetUserProfileVersion: row.target_user_profile_version,
        idempotencyKey: row.idempotency_key,
        userSnapshotId: row.user_snapshot_id,
        targetUserSnapshotId: row.target_user_snapshot_id,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        errorMessage: row.error_message,
        retryCount: row.retry_count,
        maxRetries: row.max_retries
      };
      
      logger.debug(`[claimPendingJob] Claimed fresh job ${job.id} for user ${job.userId} (priority ${job.priority}, staleness pre-filtered at DB level)`);
      return job;
    } catch (error) {
      logger.error(`[claimPendingJob] Error claiming pending job:`, error);
      throw error;
    }
  }

  async recoverStaleQueueWork(staleBefore: string): Promise<{ jobs: number; callbacks: number; pushes: number }> {
    try {
      const staleJobCondition = and(
        or(
          eq(matchGenerationJobs.status, 'PROCESSING'),
          eq(matchGenerationJobs.status, 'IN_PROGRESS'),
        ),
        or(
          isNull(matchGenerationJobs.startedAt),
          lt(matchGenerationJobs.startedAt, staleBefore),
        ),
      );
      const jobs = await db
        .update(matchGenerationJobs)
        .set({
          status: 'PENDING',
          startedAt: null,
          errorMessage: 'Recovered stale processing work',
        })
        .where(staleJobCondition);
      const callbacks = await db
        .update(callbackNotificationQueue)
        .set({
          status: 'pending',
          errorMessage: 'Recovered stale processing work',
        })
        .where(and(
          eq(callbackNotificationQueue.status, 'processing'),
          or(
            isNull(callbackNotificationQueue.lastAttemptAt),
            lt(callbackNotificationQueue.lastAttemptAt, staleBefore),
          ),
        ));
      const pushes = await db
        .update(queuedPushNotifications)
        .set({
          status: 'pending',
          errorMessage: 'Recovered stale processing work',
        })
        .where(and(
          eq(queuedPushNotifications.status, 'processing'),
          or(
            isNull(queuedPushNotifications.lastAttemptAt),
            lt(queuedPushNotifications.lastAttemptAt, staleBefore),
          ),
        ));

      const recovered = {
        jobs: jobs.rowCount || 0,
        callbacks: callbacks.rowCount || 0,
        pushes: pushes.rowCount || 0,
      };
      recordQueueEvent('jobs', 'recovered', recovered.jobs);
      recordQueueEvent('callbacks', 'recovered', recovered.callbacks);
      recordQueueEvent('push', 'recovered', recovered.pushes);
      return recovered;
    } catch (error) {
      logger.error('[Queue Recovery] Error recovering stale work:', error);
      throw error;
    }
  }

  async updateMatchGenerationJob(
    jobId: number,
    updates: Partial<MatchGenerationJob>,
    expectedStatus?: MatchGenerationJob['status']
  ): Promise<boolean> {
    try {
      const updated = await db
        .update(matchGenerationJobs)
        .set(updates)
        .where(and(
          eq(matchGenerationJobs.id, jobId),
          expectedStatus ? eq(matchGenerationJobs.status, expectedStatus) : sql`1=1`
        ))
        .returning({ id: matchGenerationJobs.id });
      
      logger.debug(`[updateMatchGenerationJob] Updated job ${jobId}:`, updates);
      return updated.length > 0;
    } catch (error) {
      logger.error(`[updateMatchGenerationJob] Error updating job ${jobId}:`, error);
      throw error;
    }
  }

  async getMatchGenerationJobStats(): Promise<{ pending: number; processing: number; completed: number; failed: number; }> {
    try {
      const stats = await db
        .select({
          status: matchGenerationJobs.status,
          count: sql<number>`count(*)`.as('count')
        })
        .from(matchGenerationJobs)
        .groupBy(matchGenerationJobs.status);
      
      const result = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0
      };
      
      for (const stat of stats) {
        switch (stat.status) {
          case 'PENDING':
          case 'RETRYING':
            result.pending += Number(stat.count);
            break;
          case 'PROCESSING':
            result.processing += Number(stat.count);
            break;
          case 'COMPLETED':
            result.completed += Number(stat.count);
            break;
          case 'FAILED':
            result.failed += Number(stat.count);
            break;
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`[getMatchGenerationJobStats] Error getting job stats:`, error);
      throw error;
    }
  }

  async deleteOldMatchGenerationJobs(cutoffDate: string): Promise<number> {
    try {
      const result = await db
        .delete(matchGenerationJobs)
        .where(
          and(
            or(
              eq(matchGenerationJobs.status, 'COMPLETED'),
              eq(matchGenerationJobs.status, 'FAILED')
            ),
            sql`${matchGenerationJobs.completedAt} < ${cutoffDate}`
          )
        );
      
      logger.debug(`[deleteOldMatchGenerationJobs] Deleted ${result.rowCount} old jobs`);
      return result.rowCount || 0;
    } catch (error) {
      logger.error(`[deleteOldMatchGenerationJobs] Error deleting old jobs:`, error);
      throw error;
    }
  }

  // CMDCC: Centralized Match & Description Command Center implementation
  async getMatchesWithVersionFilter(userId: number, includeStale: boolean = false): Promise<(SynergyMatch & { matchedUser: User })[]> {
    try {
      logger.debug(`[CMDCC] Getting matches for user ${userId}, includeStale: ${includeStale}`);
      
      if (includeStale) {
        // Return all matches regardless of staleness
        return this.getSavedSynergyMatches(userId);
      } else {
        // Return only fresh matches (this is already the default behavior)
        return this.getSavedSynergyMatches(userId);
      }
    } catch (error) {
      logger.error('[CMDCC] Error getting matches with version filter:', error);
      throw error;
    }
  }

  async markMatchesStaleForUser(userId: number, reason: string): Promise<number> {
    try {
      logger.debug(`[CMDCC] Marking matches stale for user ${userId}, reason: ${reason}`);
      
      const result = await db
        .update(synergyMatches)
        .set({
          generationStatus: 'STALE',
          updatedAt: new Date().toISOString()
        })
        .where(
          and(
            eq(synergyMatches.userId, userId),
            eq(synergyMatches.generationStatus, 'READY')
          )
        );
      
      const affectedRows = result.rowCount || 0;
      logger.debug(`[CMDCC] Marked ${affectedRows} matches as stale for user ${userId}`);
      return affectedRows;
    } catch (error) {
      logger.error('[CMDCC] Error marking matches stale:', error);
      throw error;
    }
  }

  /**
   * Marks specific matches between two users as stale
   * Used for bidirectional match propagation when one user updates their profile
   */
  async markSpecificMatchesStale(userId: number, otherUserId: number, reason: string): Promise<number> {
    try {
      logger.debug(`[CMDCC] Marking specific matches stale between users ${userId} and ${otherUserId}, reason: ${reason}`);
      
      const result = await db
        .update(synergyMatches)
        .set({
          generationStatus: 'STALE',
          updatedAt: new Date().toISOString()
        })
        .where(
          and(
            eq(synergyMatches.userId, userId),
            eq(synergyMatches.matchedUserId, otherUserId),
            eq(synergyMatches.generationStatus, 'READY')
          )
        );
      
      const affectedRows = result.rowCount || 0;
      logger.debug(`[CMDCC] Marked ${affectedRows} specific matches as stale between users ${userId} and ${otherUserId}`);
      return affectedRows;
    } catch (error) {
      logger.error('[CMDCC] Error marking specific matches stale:', error);
      throw error;
    }
  }

  async getStaleMatchCountForUser(userId: number): Promise<number> {
    try {
      const staleMatches = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(synergyMatches)
        .where(
          and(
            eq(synergyMatches.userId, userId),
            eq(synergyMatches.generationStatus, 'STALE')
          )
        );
      
      return Number(staleMatches[0]?.count || 0);
    } catch (error) {
      logger.error('[CMDCC] Error getting stale match count:', error);
      throw error;
    }
  }

  async incrementUserProfileVersion(userId: number): Promise<User> {
    try {
      logger.debug(`[CMDCC] Incrementing profile version for user ${userId}`);
      
      const [updatedUser] = await db
        .update(users)
        .set({
          profileVersion: sql`${users.profileVersion} + 1`
        })
        .where(eq(users.id, userId))
        .returning();
      
      logger.debug(`[CMDCC] User ${userId} profile version updated to ${updatedUser.profileVersion}`);
      return updatedUser;
    } catch (error) {
      logger.error('[CMDCC] Error incrementing profile version:', error);
      throw error;
    }
  }

  async cancelStaleJobsForUser(userId: number, newProfileVersion: number): Promise<number> {
    try {
      logger.debug(`[CMDCC] Canceling stale jobs for user ${userId} with new version ${newProfileVersion}`);
      
      const result = await db
        .update(matchGenerationJobs)
        .set({
          status: 'CANCELLED',
          completedAt: new Date().toISOString()
        })
        .where(
          and(
            eq(matchGenerationJobs.userId, userId),
            or(
              eq(matchGenerationJobs.status, 'PENDING'),
              eq(matchGenerationJobs.status, 'RETRYING')
            )
          )
        );
      
      const cancelledJobs = result.rowCount || 0;
      logger.debug(`[CMDCC] Cancelled ${cancelledJobs} stale jobs for user ${userId}`);
      return cancelledJobs;
    } catch (error) {
      logger.error('[CMDCC] Error canceling stale jobs:', error);
      throw error;
    }
  }

  // FCM Token methods for iOS native push notifications with multi-device support
  async storeFcmToken(userId: number, deviceToken: string, platform: string, deviceId?: string, deviceModel?: string, osVersion?: string): Promise<void> {
    try {
      const deviceInfo = deviceId ? ` (Device: ${deviceId}, Model: ${deviceModel}, OS: ${osVersion})` : '';
      logger.debug(`[FCM Storage] Storing FCM token for user ${userId} on platform ${platform}${deviceInfo}`);
      
      // Check if token already exists for a different user
      const existingToken = await db
        .select()
        .from(fcmTokens)
        .where(eq(fcmTokens.deviceToken, deviceToken))
        .limit(1);
      
      if (existingToken.length > 0 && existingToken[0].userId !== userId) {
        logger.debug(`[FCM Storage] Token exists for different user (${existingToken[0].userId}), reassigning to user ${userId}`);
        // Delete old token before inserting new one
        await db
          .delete(fcmTokens)
          .where(eq(fcmTokens.deviceToken, deviceToken));
      }
      
      // Use INSERT ... ON CONFLICT to handle duplicates for same user
      // Build update object conditionally to preserve existing metadata when not provided
      const updateSet: {
        lastUsed: string;
        deviceId?: string | null;
        deviceModel?: string | null;
        osVersion?: string | null;
      } = {
        lastUsed: new Date().toISOString()
      };
      
      // Only update device metadata fields if explicitly provided (preserve existing values otherwise)
      if (deviceId !== undefined) updateSet.deviceId = deviceId;
      if (deviceModel !== undefined) updateSet.deviceModel = deviceModel;
      if (osVersion !== undefined) updateSet.osVersion = osVersion;
      
      await db
        .insert(fcmTokens)
        .values({
          userId,
          deviceToken,
          platform,
          deviceId: deviceId || null,
          deviceModel: deviceModel || null,
          osVersion: osVersion || null,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString()
        })
        .onConflictDoUpdate({
          target: fcmTokens.deviceToken,
          set: updateSet
        });
      
      logger.debug(`[FCM Storage] Successfully stored FCM token for user ${userId}${deviceInfo}`);
    } catch (error) {
      logger.error('[FCM Storage] Error storing FCM token:', error);
      throw error;
    }
  }

  async getFcmTokensByUserId(userId: number, platform?: string): Promise<string[]> {
    try {
      logger.debug(`[FCM Storage] Fetching FCM tokens for user ${userId}${platform ? ` on platform ${platform}` : ''}`);
      
      const whereConditions = platform
        ? and(eq(fcmTokens.userId, userId), eq(fcmTokens.platform, platform))
        : eq(fcmTokens.userId, userId);
      
      const tokens = await db
        .select()
        .from(fcmTokens)
        .where(whereConditions);
      
      const tokenStrings = tokens.map(t => t.deviceToken);
      logger.debug(`[FCM Storage] Found ${tokenStrings.length} FCM token(s) for user ${userId}${platform ? ` on platform ${platform}` : ''}`);
      
      return tokenStrings;
    } catch (error) {
      logger.error('[FCM Storage] Error fetching FCM tokens:', error);
      throw error;
    }
  }

  async deleteFcmToken(deviceToken: string): Promise<void> {
    try {
      logger.debug(`[FCM Storage] Deleting FCM token, length: ${deviceToken.length}`);
      
      await db
        .delete(fcmTokens)
        .where(eq(fcmTokens.deviceToken, deviceToken));
      
      logger.debug(`[FCM Storage] Successfully deleted FCM token`);
    } catch (error) {
      logger.error('[FCM Storage] Error deleting FCM token:', error);
      throw error;
    }
  }

  async updateFcmTokenLastUsed(deviceToken: string): Promise<void> {
    try {
      logger.debug(`[FCM Storage] Updating last used timestamp for FCM token`);
      
      await db
        .update(fcmTokens)
        .set({ lastUsed: new Date().toISOString() })
        .where(eq(fcmTokens.deviceToken, deviceToken));
      
      logger.debug(`[FCM Storage] Successfully updated FCM token last used timestamp`);
    } catch (error) {
      logger.error('[FCM Storage] Error updating FCM token last used:', error);
      throw error;
    }
  }

  async deleteStaleTokens(daysOld: number): Promise<number> {
    try {
      logger.debug(`[FCM Storage] Deleting tokens not used in ${daysOld} days...`);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      const cutoffIso = cutoffDate.toISOString();
      
      const result = await db.execute(sql`
        DELETE FROM fcm_tokens
        WHERE last_used < ${cutoffIso}
        RETURNING id
      `);
      
      const deletedCount = result.rows.length;
      logger.debug(`[FCM Storage] Successfully deleted ${deletedCount} stale token(s)`);
      
      return deletedCount;
    } catch (error) {
      logger.error('[FCM Storage] Error deleting stale tokens:', error);
      throw error;
    }
  }

  // Queued push notification methods for APNs fallback
  async enqueuePushNotification(userId: number, payload: string, priority: 'critical' | 'standard', expiresAt: string): Promise<void> {
    try {
      logger.debug(`[Queue Storage] Enqueueing push notification for user ${userId} with priority ${priority}`);
      
      await db.execute(sql`
        INSERT INTO queued_push_notifications (user_id, payload, priority, expires_at)
        VALUES (${userId}, ${payload}, ${priority}, ${expiresAt})
      `);
      
      logger.debug(`[Queue Storage] Successfully enqueued push notification for user ${userId}`);
    } catch (error) {
      logger.error('[Queue Storage] Error enqueueing push notification:', error);
      throw error;
    }
  }

  async getPendingQueuedNotifications(limit: number): Promise<Array<{id: number, userId: number, payload: string, priority: string, attemptCount: number}>> {
    try {
      const result = await db.execute(sql`
        SELECT id, user_id as "userId", payload, priority, attempt_count as "attemptCount"
        FROM queued_push_notifications
        WHERE status = 'pending' AND expires_at > NOW()::TEXT
        ORDER BY priority DESC, enqueued_at ASC
        LIMIT ${limit}
      `);
      
      return result.rows as Array<{id: number, userId: number, payload: string, priority: string, attemptCount: number}>;
    } catch (error) {
      logger.error('[Queue Storage] Error getting pending queued notifications:', error);
      throw error;
    }
  }

  async claimPendingQueuedNotification(): Promise<{id: number, userId: number, payload: string, priority: string, attemptCount: number} | null> {
    const result = await db.execute(sql`
      UPDATE queued_push_notifications SET status = 'processing',
        attempt_count = attempt_count + 1, last_attempt_at = NOW()
      WHERE id = (
        SELECT id FROM queued_push_notifications
        WHERE (
            status = 'pending'
            AND (
              last_attempt_at IS NULL
              OR last_attempt_at < NOW() - (LEAST(POWER(2, attempt_count), 300) * INTERVAL '1 second')
            )
          OR status = 'processing'
            AND last_attempt_at < NOW() - INTERVAL '10 minutes'
        )
          AND expires_at > NOW()
        ORDER BY CASE WHEN priority = 'critical' THEN 0 ELSE 1 END, enqueued_at
        LIMIT 1 FOR UPDATE SKIP LOCKED
      ) RETURNING id, user_id as "userId", payload, priority, attempt_count as "attemptCount"
    `);
    return (result.rows[0] as {id: number, userId: number, payload: string, priority: string, attemptCount: number}) || null;
  }

  async updateQueuedNotificationStatus(id: number, status: string, errorMessage?: string): Promise<void> {
    try {
      if (errorMessage) {
        await db.execute(sql`
          UPDATE queued_push_notifications
          SET status = ${status}, error_message = ${errorMessage}, last_attempt_at = NOW()::TEXT
          WHERE id = ${id}
        `);
      } else {
        await db.execute(sql`
          UPDATE queued_push_notifications
          SET status = ${status}, last_attempt_at = NOW()::TEXT,
              error_message = CASE WHEN ${status} = 'pending' THEN error_message ELSE NULL END
          WHERE id = ${id}
        `);
      }
    } catch (error) {
      logger.error('[Queue Storage] Error updating queued notification status:', error);
      throw error;
    }
  }

  async incrementQueuedNotificationAttempts(id: number): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE queued_push_notifications
        SET attempt_count = attempt_count + 1
        WHERE id = ${id}
      `);
    } catch (error) {
      logger.error('[Queue Storage] Error incrementing queued notification attempts:', error);
      throw error;
    }
  }

  async deleteExpiredQueuedNotifications(): Promise<number> {
    try {
      const result = await db.execute(sql`
        DELETE FROM queued_push_notifications
        WHERE expires_at < NOW()::TEXT OR status = 'completed'
      `);
      
      const deletedCount = result.rowCount || 0;
      if (deletedCount > 0) {
        logger.debug(`[Queue Storage] Deleted ${deletedCount} expired/completed queued notifications`);
      }
      
      return deletedCount;
    } catch (error) {
      logger.error('[Queue Storage] Error deleting expired queued notifications:', error);
      throw error;
    }
  }

  async getQueuedNotificationStats(): Promise<{pending: number, processing: number, failed: number}> {
    try {
      const result = await db.execute(sql`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'processing') as processing,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM queued_push_notifications
      `);
      
      const row = result.rows[0] as { pending?: string | number; processing?: string | number; failed?: string | number };
      return {
        pending: Number(row.pending || 0),
        processing: Number(row.processing || 0),
        failed: Number(row.failed || 0)
      };
    } catch (error) {
      logger.error('[Queue Storage] Error getting queued notification stats:', error);
      throw error;
    }
  }

  // Dead letter queue methods for permanently failed jobs
  async moveJobToDeadLetterQueue(jobId: number, failureReason: string): Promise<void> {
    try {
      logger.debug(`[DeadLetterQueue] Moving job ${jobId} to dead letter queue`);
      
      const job = await this.getMatchGenerationJob(jobId);
      if (!job) {
        logger.warn(`[DeadLetterQueue] Job ${jobId} not found, cannot move to dead letter queue`);
        return;
      }

      const retryHistory = {
        retryCount: job.retryCount,
        maxRetries: job.maxRetries,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        errorMessage: job.errorMessage
      };

      const deadLetterData: InsertMatchGenerationDeadLetter = {
        originalJobId: job.id,
        userId: job.userId,
        jobType: job.jobType,
        metadata: job.metadata || undefined,
        priority: job.priority,
        failureReason,
        retryHistory: JSON.stringify(retryHistory),
        failedAt: new Date().toISOString(),
        createdAt: job.createdAt,
        lastAttemptAt: job.completedAt || undefined
      };

      await db.insert(matchGenerationDeadLetters).values(deadLetterData);
      
      await db.delete(matchGenerationJobs).where(eq(matchGenerationJobs.id, jobId));
      
      logger.debug(`[DeadLetterQueue] Job ${jobId} moved to dead letter queue successfully`);
    } catch (error) {
      logger.error(`[DeadLetterQueue] Error moving job ${jobId} to dead letter queue:`, error);
      throw error;
    }
  }

  async getDeadLetterJobs(limit: number): Promise<MatchGenerationDeadLetter[]> {
    try {
      const deadLetters = await db
        .select()
        .from(matchGenerationDeadLetters)
        .orderBy(desc(matchGenerationDeadLetters.failedAt))
        .limit(limit);

      return deadLetters;
    } catch (error) {
      logger.error('[DeadLetterQueue] Error fetching dead letter jobs:', error);
      throw error;
    }
  }

  async retryDeadLetterJob(deadLetterId: number): Promise<void> {
    try {
      logger.debug(`[DeadLetterQueue] Retrying dead letter job ${deadLetterId}`);
      
      const [deadLetter] = await db
        .select()
        .from(matchGenerationDeadLetters)
        .where(eq(matchGenerationDeadLetters.id, deadLetterId));

      if (!deadLetter) {
        throw new Error(`Dead letter job ${deadLetterId} not found`);
      }

      const newJobData: InsertMatchGenerationJob = {
        userId: deadLetter.userId,
        jobType: deadLetter.jobType as InsertMatchGenerationJob['jobType'],
        status: 'PENDING',
        metadata: deadLetter.metadata || undefined,
        idempotencyKey: (() => {
          let metadata: {
            targetUserId?: number;
            userProfileVersion?: number;
            targetUserProfileVersion?: number;
            mode?: 'SUMMARY_STUB' | 'PROFILE_UPDATE';
            regenerationEpoch?: number;
          } = {};
          try {
            metadata = deadLetter.metadata ? JSON.parse(deadLetter.metadata) : {};
          } catch {
            // The canonical unknown-version identity remains deterministic.
          }
          const scope = getMatchGenerationScope(
            deadLetter.jobType as MatchGenerationJob['jobType'],
            metadata.targetUserId,
            metadata.mode
          );
          return buildMatchGenerationIdempotencyKey({
            jobType: deadLetter.jobType as MatchGenerationJob['jobType'],
            userId: deadLetter.userId,
            targetUserId: metadata.targetUserId,
            userProfileVersion: metadata.userProfileVersion,
            targetUserProfileVersion: metadata.targetUserProfileVersion,
            generationScope: scope,
            regenerationEpoch: metadata.regenerationEpoch
          });
        })(),
        priority: deadLetter.priority,
        createdAt: new Date().toISOString(),
        retryCount: 0,
        maxRetries: 3
      };

      // Keep requeue and removal atomic: a crash cannot duplicate or lose a retry.
      const newJob = await db.transaction(async (tx) => {
        const [created] = await tx.insert(matchGenerationJobs).values(newJobData).returning();
        if (!created) throw new Error(`Unable to requeue dead letter job ${deadLetterId}`);
        await tx.delete(matchGenerationDeadLetters).where(eq(matchGenerationDeadLetters.id, deadLetterId));
        return created;
      });
      
      logger.debug(`[DeadLetterQueue] Dead letter job ${deadLetterId} re-queued as job ${newJob.id}`);
    } catch (error) {
      logger.error(`[DeadLetterQueue] Error retrying dead letter job ${deadLetterId}:`, error);
      throw error;
    }
  }

  /**
   * Get pending callback notifications from the queue
   * Sorted by priority (ascending) and enqueued time (oldest first)
   */
  async getPendingCallbackNotifications(limit: number): Promise<CallbackNotification[]> {
    try {
      const notifications = await db
        .select()
        .from(callbackNotificationQueue)
        .where(
          and(
            eq(callbackNotificationQueue.status, 'pending'),
            sql`${callbackNotificationQueue.expiresAt} > NOW()`
          )
        )
        .orderBy(
          asc(callbackNotificationQueue.priority),
          asc(callbackNotificationQueue.enqueuedAt)
        )
        .limit(limit);

      return notifications;
    } catch (error) {
      logger.error('[CallbackQueue] Error fetching pending notifications:', error);
      throw error;
    }
  }

  async enqueueCallbackNotification(
    userId: number,
    notificationType: string,
    payload: string,
    priority: number,
    expiresAt: string,
    dedupeKey?: string,
  ): Promise<CallbackNotification> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('Invalid callback notification user');
    }
    if (!notificationType || notificationType.length > 64) {
      throw new Error('Invalid callback notification type');
    }
    if (payload.length > 32_768) {
      throw new Error('Callback notification payload is too large');
    }
    const values = {
      userId,
      notificationType,
      payload,
      priority: Math.max(1, Math.min(10, Math.floor(priority))),
      expiresAt,
      status: 'pending' as const,
      ...(dedupeKey ? { dedupeKey } : {}),
    };
    const [notification] = await db
      .insert(callbackNotificationQueue)
      .values(values)
      .onConflictDoNothing()
      .returning();
    if (!notification && dedupeKey) {
      const [existing] = await db
        .select()
        .from(callbackNotificationQueue)
        .where(eq(callbackNotificationQueue.dedupeKey, dedupeKey))
        .limit(1);
      if (existing) return existing;
    }
    if (!notification) {
      throw new Error('Unable to enqueue callback notification');
    }
    recordQueueEvent('callbacks', 'enqueued');
    return notification;
  }

  async dispatchPendingDeliveryObligations(limit: number): Promise<number> {
    const pending = await db
      .select()
      .from(deliveryObligations)
      .where(and(
        eq(deliveryObligations.status, 'pending'),
        sql`${deliveryObligations.expiresAt} > NOW()`,
      ))
      .orderBy(asc(deliveryObligations.createdAt))
      .limit(Math.max(1, Math.min(100, Math.floor(limit))));

    let dispatched = 0;
    for (const obligation of pending) {
      await db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(deliveryObligations)
          .set({ status: 'completed', completedAt: new Date().toISOString() })
          .where(and(
            eq(deliveryObligations.id, obligation.id),
            eq(deliveryObligations.status, 'pending'),
          ))
          .returning({ id: deliveryObligations.id });
        if (!claimed) return;

        await tx.insert(callbackNotificationQueue).values({
          userId: obligation.userId,
          notificationType: obligation.eventType,
          payload: obligation.payload,
          priority: 2,
          expiresAt: obligation.expiresAt,
          status: 'pending',
          dedupeKey: obligation.dedupeKey,
        }).onConflictDoNothing();
        dispatched += 1;
      });
    }

    const expired = await db
      .update(deliveryObligations)
      .set({ status: 'expired', completedAt: new Date().toISOString() })
      .where(and(
        eq(deliveryObligations.status, 'pending'),
        lte(deliveryObligations.expiresAt, new Date().toISOString()),
      ));
    if ((expired.rowCount || 0) > 0) {
      logger.warn('[Delivery Obligations] Expired undelivered obligations', {
        count: expired.rowCount || 0,
      });
    }
    return dispatched;
  }

  async completeDeliveryObligation(dedupeKey: string): Promise<void> {
    await db
      .update(deliveryObligations)
      .set({ status: 'completed', completedAt: new Date().toISOString() })
      .where(and(
        eq(deliveryObligations.dedupeKey, dedupeKey),
        eq(deliveryObligations.status, 'pending'),
      ));
  }

  async claimPendingCallbackNotification(): Promise<CallbackNotification | null> {
    const result = await db.execute(sql`
      UPDATE callback_notification_queue SET status = 'processing',
        attempt_count = attempt_count + 1, last_attempt_at = NOW()
      WHERE id = (
        SELECT id FROM callback_notification_queue
        WHERE (
            status = 'pending'
            AND (
              last_attempt_at IS NULL
              OR last_attempt_at < NOW() - (LEAST(POWER(2, attempt_count), 30) * INTERVAL '1 second')
            )
          OR status = 'processing'
            AND last_attempt_at < NOW() - INTERVAL '10 minutes'
        )
          AND expires_at > NOW()
        ORDER BY priority ASC, enqueued_at ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED
      ) RETURNING id, user_id as "userId", notification_type as "notificationType",
        payload, priority, enqueued_at as "enqueuedAt", expires_at as "expiresAt",
        attempt_count as "attemptCount", status, last_attempt_at as "lastAttemptAt",
        error_message as "errorMessage"
    `);
    return (result.rows[0] as CallbackNotification) || null;
  }

  /**
   * Update callback notification status and metadata
   */
  async updateCallbackNotification(id: number, updates: Partial<CallbackNotification>): Promise<void> {
    try {
      const safeUpdates = { ...updates };
      if (safeUpdates.status === 'pending' || safeUpdates.status === 'failed' || safeUpdates.status === 'completed') {
        safeUpdates.lastAttemptAt = new Date().toISOString();
      }
      await db
        .update(callbackNotificationQueue)
        .set(safeUpdates)
        .where(eq(callbackNotificationQueue.id, id));
      
      logger.debug(`[CallbackQueue] Updated notification ${id} with status: ${safeUpdates.status}`);
    } catch (error) {
      logger.error(`[CallbackQueue] Error updating notification ${id}:`, error);
      throw error;
    }
  }

  async getCallbackNotificationStats(): Promise<{ pending: number; processing: number; failed: number }> {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM callback_notification_queue
    `);
    const row = result.rows[0] as {
      pending?: string | number;
      processing?: string | number;
      failed?: string | number;
    } | undefined;
    return {
      pending: Number(row?.pending || 0),
      processing: Number(row?.processing || 0),
      failed: Number(row?.failed || 0),
    };
  }

  // Refresh token management methods for JWT authentication
  async createRefreshToken(refreshTokenData: InsertRefreshToken): Promise<RefreshToken> {
    logger.debug('[Storage] Creating refresh token for user:', refreshTokenData.userId, 'device:', refreshTokenData.deviceId);

    const [user] = await db
      .select({ accountStatus: users.accountStatus })
      .from(users)
      .where(eq(users.id, refreshTokenData.userId))
      .limit(1);
    if (!isActiveAccount(user)) {
      throw new Error('Account is not active');
    }
    
    const [token] = await db
      .insert(refreshTokens)
      .values(refreshTokenData)
      .returning();
    
    logger.debug('[Storage] Refresh token created with id:', token.id);
    return token;
  }

  async rotateRefreshToken(
    tokenHash: string,
    deviceId: string,
    successor: InsertRefreshToken,
  ): Promise<
    | { status: 'rotated'; token: RefreshToken; user: User }
    | { status: 'not_found' }
    | { status: 'expired'; userId: number }
    | { status: 'device_mismatch'; userId: number; expectedDeviceId: string }
    | { status: 'user_missing'; userId: number }
    | { status: 'account_inactive'; userId: number }
  > {
    return db.transaction(async (tx) => {
      const [token] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .for('update');

      if (!token) return { status: 'not_found' as const };
      if (new Date(token.expiresAt).getTime() <= Date.now()) {
        return { status: 'expired' as const, userId: token.userId };
      }
      if (token.deviceId !== deviceId) {
        return {
          status: 'device_mismatch' as const,
          userId: token.userId,
          expectedDeviceId: token.deviceId,
        };
      }

      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, token.userId))
        .limit(1);
      if (!user) return { status: 'user_missing' as const, userId: token.userId };
      if (!isActiveAccount(user)) {
        return { status: 'account_inactive' as const, userId: token.userId };
      }

      const [consumed] = await tx
        .delete(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .returning();
      if (!consumed) return { status: 'not_found' as const };

      const [created] = await tx
        .insert(refreshTokens)
        .values({ ...successor, userId: token.userId })
        .returning();

      return { status: 'rotated' as const, token: created, user };
    });
  }

  async getRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    logger.debug('[Storage] Fetching refresh token by hash');
    
    const [token] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    
    if (!token) {
      logger.debug('[Storage] Refresh token not found for hash');
      return null;
    }
    
    logger.debug('[Storage] Refresh token found for user:', token.userId, 'device:', token.deviceId);
    return token;
  }

  async getRefreshTokenByUserAndDevice(userId: number, deviceId: string): Promise<RefreshToken | null> {
    logger.debug('[Storage] Fetching refresh token for user:', userId, 'device:', deviceId);
    
    const tokens = await db
      .select()
      .from(refreshTokens)
      .where(and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.deviceId, deviceId)
      ))
      .orderBy(desc(refreshTokens.createdAt));
    
    if (tokens.length === 0) {
      logger.debug('[Storage] No refresh token found for user:', userId, 'device:', deviceId);
      return null;
    }
    
    logger.debug('[Storage] Found', tokens.length, 'token(s), returning most recent');
    return tokens[0];
  }

  async getRefreshTokensForUser(userId: number): Promise<Array<Pick<RefreshToken, 'id' | 'deviceId' | 'deviceInfo' | 'lastUsedAt' | 'expiresAt'>>> {
    logger.debug('[Storage] Fetching all refresh tokens for user:', userId);
    
    const tokens = await db
      .select({
        id: refreshTokens.id,
        deviceId: refreshTokens.deviceId,
        deviceInfo: refreshTokens.deviceInfo,
        lastUsedAt: refreshTokens.lastUsedAt,
        expiresAt: refreshTokens.expiresAt
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId))
      .orderBy(desc(refreshTokens.lastUsedAt));
    
    logger.debug('[Storage] Found', tokens.length, 'active sessions for user:', userId);
    return tokens;
  }

  async deleteRefreshToken(tokenHash: string): Promise<void> {
    logger.debug('[Storage] Deleting refresh token by hash');
    
    await db
      .delete(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    
    logger.debug('[Storage] Refresh token deleted');
  }

  async deleteRefreshTokensByDevice(userId: number, deviceId: string): Promise<void> {
    logger.debug('[Storage] Deleting all refresh tokens for user:', userId, 'device:', deviceId);
    
    await db
      .delete(refreshTokens)
      .where(and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.deviceId, deviceId)
      ));
    
    logger.debug('[Storage] Deleted tokens for device');
  }

  async deleteAllUserTokens(userId: number): Promise<void> {
    logger.debug('[Storage] Deleting all refresh tokens for user:', userId);
    
    await db
      .delete(refreshTokens)
      .where(eq(refreshTokens.userId, userId));
    
    logger.debug('[Storage] All user tokens deleted');
  }

  async updateRefreshTokenLastUsed(tokenHash: string): Promise<void> {
    logger.debug('[Storage] Updating lastUsedAt for refresh token');
    
    await db
      .update(refreshTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(refreshTokens.tokenHash, tokenHash));
    
    logger.debug('[Storage] Refresh token lastUsedAt updated');
  }

  async cleanupExpiredTokens(): Promise<number> {
    logger.debug('[Storage] Cleaning up expired refresh tokens');
    
    const result = await db
      .delete(refreshTokens)
      .where(lte(refreshTokens.expiresAt, sql`now()`))
      .returning({ id: refreshTokens.id });
    
    const count = result.length;
    logger.debug('[Storage] Cleaned up', count, 'expired refresh tokens');
    return count;
  }

  async logRefreshTokenReuse(reuseEvent: InsertRefreshTokenReuseEvent): Promise<void> {
    logger.debug('[Storage] Logging refresh token reuse event for user:', reuseEvent.userId, 'device:', reuseEvent.deviceId, 'action:', reuseEvent.action);
    
    await db
      .insert(refreshTokenReuseEvents)
      .values(reuseEvent);
    
    logger.debug('[Storage] Refresh token reuse event logged');
  }
}

export const storage = new DatabaseStorage();