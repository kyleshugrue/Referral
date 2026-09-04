import type { IStorage } from '../storage';
import type { MatchGenerationJob, InsertMatchGenerationJob, User } from '../../shared/schema';
import { matchGenerationJobs, callbackNotificationQueue, synergyMatches } from '../../shared/schema';
import {
  connectDatabase,
  createDatabasePool,
  type DatabaseClient,
  type DatabasePool,
} from '../lib/database-client';
import { db } from '../db';
import { sql, eq, or, and, lte } from 'drizzle-orm';
import { snapshotService, type ProfileData } from './profile-snapshot-service';
import { logger } from '../lib/logger';
import { recordQueueEvent } from '../lib/operational-metrics';

import type { JobStatus } from '../../shared/schema';
import {
  buildMatchGenerationIdempotencyKey,
  getMatchGenerationScope,
} from '../../shared/match-generation-contract';
export type { JobStatus };
export type JobType = 'MATCH_DESCRIPTION' | 'BATCH_PROFILES' | 'USER_PROFILE_UPDATE';

export interface JobMetadata {
  userId?: number;
  targetUserId?: number;
  profileUpdated?: boolean;
  batchSize?: number;
  profiles?: number[];
  priority?: number;
  // Profile version tracking for staleness detection
  userProfileVersion?: number;
  targetUserProfileVersion?: number;
  // Match justification snapshot at job creation
  matchReasons?: string[];
  expectedJustification?: string;
  // Update type for incremental updates
  updateType?: 'new_match' | 'update_description' | 'reciprocal_new' | 'reciprocal_update' | 'fallback_full';
  // Generation mode indicator for Worker VM to identify seed/initializer jobs
  // SUMMARY_STUB tells Worker VM to create GENERATING rows before processing per-target jobs
  mode?: 'SUMMARY_STUB' | 'PROFILE_UPDATE';
  generationScope?: 'TARGETLESS_SEED' | 'DIRECTED_MATCH' | 'BATCH_PROFILES' | 'PROFILE_UPDATE';
  regenerationEpoch?: number;
  idempotencyKey?: string;
  score?: number;
  scoreEvidence?: string;
  forceRegeneration?: boolean;
}

export interface JobResult {
  success: boolean;
  data?: unknown;
  error?: string;
  processingTime?: number;
}

interface NotificationWaiter {
  resolve: () => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export class BackgroundJobQueue {
  private storage: IStorage;
  private isProcessing = false;
  private processingPromise: Promise<void> | null = null;
  
  // Event-driven architecture members
  private listenPool: DatabasePool | null = null;
  private listenClient: DatabaseClient | null = null;
  private jobAvailableResolvers: NotificationWaiter[] = [];
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private isStopping = false;
  private lastNotifyTime = 0;
  
  private readonly HIGH_PRIORITY_THRESHOLD = 5; // Jobs with priority <= 5 are high-priority
  private readonly MAX_CONCURRENT_WORKERS = 50; // Maximum concurrent workers (matches Tier 1 RPM limit)
  private readonly MAX_RECONNECT_DELAY = 30000; // 30 seconds max reconnect delay
  private readonly FALLBACK_POLL_INTERVAL = 60000; // 60 seconds fallback polling

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Setup PostgreSQL LISTEN connection for event-driven job processing
   */
  private async setupListenConnection(): Promise<void> {
    if (this.isStopping) return;
    try {
      console.log('[EventDriven] Setting up LISTEN connection to PostgreSQL...');
      
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL not configured');
      }

      // Create a dedicated connection pool for LISTEN
      this.listenPool = createDatabasePool({
        connectionString: process.env.DATABASE_URL,
        max: 1, // Only need 1 connection for LISTEN
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis: 0, // Never timeout - keep connection alive
        allowExitOnIdle: false
      });

      // Get a dedicated client from the pool and NEVER release it
      // This client must stay alive to receive NOTIFY events
      this.listenClient = await connectDatabase(this.listenPool);
      
      // Set up notification handler on the CLIENT (not the pool)
      this.listenClient.onNotification((msg) => {
        if (msg.channel === 'job_queued' && msg.payload) {
          this.handleNotification(msg.payload);
        }
      });

      // Handle connection errors. Use the sanitizing logger, not
      // console.error: pg/neon error objects carry a `connectionString`
      // property (the full DATABASE_URL, including the password) that
      // console.error would otherwise print verbatim into logs.
      this.listenClient.onError((err) => {
        logger.error('[EventDriven] LISTEN connection error:', err);
        this.reconnectListener();
      });

      // Execute LISTEN command on the dedicated client
      await this.listenClient.query('LISTEN job_queued');
      
      this.reconnectAttempts = 0;
      this.lastNotifyTime = Date.now();
      console.log('[EventDriven] ✅ LISTEN connection established successfully');
      
    } catch (error) {
      // Sanitizing logger: this catch can see the raw pg/neon connection
      // error, whose object carries a `connectionString` property (the
      // full DATABASE_URL, including the password).
      logger.error('[EventDriven] Failed to setup LISTEN connection:', error);
      this.reconnectListener();
    }
  }

  /**
   * Handle NOTIFY event from PostgreSQL
   */
  private handleNotification(payload: string): void {
    try {
      this.lastNotifyTime = Date.now();
      const jobData = JSON.parse(payload);
      console.log(`[EventDriven] NOTIFY received for job ${jobData.id} (priority ${jobData.priority}, type ${jobData.jobType})`);
      
      // Wake all workers to compete for the job
      this.wakeAllWorkers();
      
    } catch (error) {
      console.error('[EventDriven] Error handling notification:', error);
    }
  }

  /**
   * Wake all workers waiting for job notifications
   */
  private wakeAllWorkers(): void {
    const resolverCount = this.jobAvailableResolvers.length;
    if (resolverCount > 0) {
      console.log(`[EventDriven] Waking ${resolverCount} waiting workers`);
      
      // Resolve all pending promises
      while (this.jobAvailableResolvers.length > 0) {
        const waiter = this.jobAvailableResolvers.shift();
        waiter?.resolve();
      }
    }
  }

  /**
   * Wait for job notification with fallback timeout
   * Returns a promise that resolves when:
   * 1. A NOTIFY is received, OR
   * 2. 60 seconds elapsed (fallback polling)
   */
  private waitForJobNotification(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const waiter: NotificationWaiter = {
        resolve: () => {
          if (settled) return;
          settled = true;
          if (waiter.timeout) clearTimeout(waiter.timeout);
          resolve();
        },
      };

      waiter.timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = this.jobAvailableResolvers.indexOf(waiter);
        if (index !== -1) {
          this.jobAvailableResolvers.splice(index, 1);
        }
        
        // Check if we haven't received a NOTIFY in a while
        const timeSinceLastNotify = Date.now() - this.lastNotifyTime;
        if (timeSinceLastNotify >= this.FALLBACK_POLL_INTERVAL) {
          console.log(`[EventDriven] Fallback polling activated (${Math.round(timeSinceLastNotify / 1000)}s since last NOTIFY)`);
        }
        
        resolve();
      }, this.FALLBACK_POLL_INTERVAL);

      this.jobAvailableResolvers.push(waiter);
    });
  }

  /**
   * Reconnect LISTEN connection with exponential backoff
   */
  private async reconnectListener(): Promise<void> {
    if (this.isReconnecting || this.isStopping || !this.isProcessing) {
      return; // Already reconnecting
    }
    
    this.isReconnecting = true;
    
    try {
      // Clean up existing connection by ending the pool (which closes the client)
      // Never call release() or end() on the client directly - it must stay connected
      this.listenClient = null;
      if (this.listenPool) {
        try {
          await this.listenPool.end();
        } catch (err) {
          logger.debug('[EventDriven] Error ending pool during reconnect:', err);
        }
        this.listenPool = null;
      }
      
      // Calculate backoff delay with exponential increase
      const backoffDelay = Math.min(
        1000 * Math.pow(2, this.reconnectAttempts),
        this.MAX_RECONNECT_DELAY
      );
      
      this.reconnectAttempts++;
      console.log(`[EventDriven] Reconnecting LISTEN in ${backoffDelay}ms (attempt ${this.reconnectAttempts})...`);
      
      await this.sleep(backoffDelay);
      
      // Attempt reconnection
      if (!this.isStopping && this.isProcessing) await this.setupListenConnection();
      
      this.isReconnecting = false;
      
    } catch (error) {
      logger.error('[EventDriven] Reconnection failed:', error);
      this.isReconnecting = false;
      this.reconnectListener(); // Retry
    }
  }

  /**
   * Check if this instance should process jobs
   * Only worker VMs with RUN_CMDCC_WORKER=true should process
   */
  private shouldProcessJobs(): boolean {
    return process.env.RUN_CMDCC_WORKER === 'true';
  }

  /**
   * Queue a new background job
   */
  async queueJob(
    userId: number,
    jobType: JobType,
    metadata: JobMetadata = {},
    priority = 5,
    maxRetries = 5
  ): Promise<MatchGenerationJob> {
    console.log(`[BackgroundJobQueue] Queueing job: ${jobType} for user ${userId}`);
    
    // Fetch current profile versions to populate top-level columns for staleness filtering
    let userProfileVersion: number | undefined;
    let targetUserProfileVersion: number | undefined;
    let userSnapshotId: number | undefined;
    let targetUserSnapshotId: number | undefined;
    
    // Get or create snapshot for the main user
    try {
      const user = await this.storage.getUser(userId);
      if (user) {
        if (user.profileVersion == null) {
          throw new Error(`Cannot queue ${jobType}: user ${userId} has no profile version`);
        }
        userProfileVersion = user.profileVersion;
        metadata.userProfileVersion = userProfileVersion;
        
        // Check if user has currentSnapshotId, otherwise create new snapshot
        if (user.currentSnapshotId) {
          const existingSnapshot = await snapshotService.getSnapshot(user.currentSnapshotId, userId);
          if (existingSnapshot) {
            userSnapshotId = existingSnapshot.id;
            console.log(`[BackgroundJobQueue] Using existing snapshot ${userSnapshotId} for user ${userId}`);
          } else {
            // Snapshot ID exists but snapshot not found, create new one
            const newSnapshot = await snapshotService.createSnapshot(userId, extractProfileData(user));
            userSnapshotId = newSnapshot.id;
            console.log(`[BackgroundJobQueue] Created new snapshot ${userSnapshotId} for user ${userId} (old snapshot not found)`);
          }
        } else {
          // No current snapshot, create new one
          const newSnapshot = await snapshotService.createSnapshot(userId, extractProfileData(user));
          userSnapshotId = newSnapshot.id;
          console.log(`[BackgroundJobQueue] Created new snapshot ${userSnapshotId} for user ${userId}`);
        }
      } else {
        throw new Error(`Cannot queue ${jobType}: user ${userId} not found`);
      }
    } catch (error) {
      console.error(`[BackgroundJobQueue] Error creating snapshot for user ${userId}:`, error);
      // Don't fail job creation, continue without snapshot
    }

    if (userProfileVersion == null) {
      throw new Error(`Cannot queue ${jobType}: user ${userId} has no trustworthy profile version`);
    }
    
    // Get or create snapshot for target user if present
    if (metadata.targetUserId != null) {
      try {
        const targetUser = await this.storage.getUser(metadata.targetUserId);
        if (targetUser) {
          if (targetUser.profileVersion == null) {
            throw new Error(`Cannot queue ${jobType}: target user ${metadata.targetUserId} has no profile version`);
          }
          targetUserProfileVersion = targetUser.profileVersion;
          metadata.targetUserProfileVersion = targetUserProfileVersion;
          
          // Check if target user has currentSnapshotId, otherwise create new snapshot
          if (targetUser.currentSnapshotId) {
            const existingSnapshot = await snapshotService.getSnapshot(targetUser.currentSnapshotId, metadata.targetUserId);
            if (existingSnapshot) {
              targetUserSnapshotId = existingSnapshot.id;
              console.log(`[BackgroundJobQueue] Using existing snapshot ${targetUserSnapshotId} for target user ${metadata.targetUserId}`);
            } else {
              // Snapshot ID exists but snapshot not found, create new one
              const newSnapshot = await snapshotService.createSnapshot(metadata.targetUserId, extractProfileData(targetUser));
              targetUserSnapshotId = newSnapshot.id;
              console.log(`[BackgroundJobQueue] Created new snapshot ${targetUserSnapshotId} for target user ${metadata.targetUserId} (old snapshot not found)`);
            }
          } else {
            // No current snapshot, create new one
            const newSnapshot = await snapshotService.createSnapshot(metadata.targetUserId, extractProfileData(targetUser));
            targetUserSnapshotId = newSnapshot.id;
            console.log(`[BackgroundJobQueue] Created new snapshot ${targetUserSnapshotId} for target user ${metadata.targetUserId}`);
          }
        } else {
          throw new Error(`Cannot queue ${jobType}: target user ${metadata.targetUserId} not found`);
        }
      } catch (error) {
        console.error(`[BackgroundJobQueue] Error creating snapshot for target user ${metadata.targetUserId}:`, error);
        // Don't fail job creation, continue without snapshot
      }
    }

    if (metadata.targetUserId != null && targetUserProfileVersion == null) {
      throw new Error(`Cannot queue ${jobType}: target user ${metadata.targetUserId} has no trustworthy profile version`);
    }
    
    const generationScope = getMatchGenerationScope(jobType, metadata.targetUserId, metadata.mode);
    metadata.generationScope = generationScope;
    const idempotencyKey = buildMatchGenerationIdempotencyKey({
      jobType,
      userId,
      targetUserId: metadata.targetUserId,
      userProfileVersion,
      targetUserProfileVersion,
      generationScope,
      regenerationEpoch: metadata.regenerationEpoch
    });
    metadata.idempotencyKey = idempotencyKey;

    const jobData: InsertMatchGenerationJob = {
      userId,
      targetUserId: metadata.targetUserId,
      jobType,
      status: 'PENDING',
      metadata: JSON.stringify(metadata),
      priority,
      userProfileVersion,
      targetUserProfileVersion,
      idempotencyKey,
      userSnapshotId,
      targetUserSnapshotId,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries
    };

    const job = await this.storage.createMatchGenerationJob(jobData);
    console.log(`[BackgroundJobQueue] Reused or created job ${job.id} (scope: ${generationScope}, userVersion: ${userProfileVersion}, targetVersion: ${targetUserProfileVersion || 'N/A'}, userSnapshot: ${userSnapshotId || 'N/A'}, targetSnapshot: ${targetUserSnapshotId || 'N/A'})`);
    
    // Send PostgreSQL NOTIFY to alert worker VM that a new job is available
    try {
      const payload = JSON.stringify({
        jobId: job.id,
        userId: userId,
        jobType: jobType
      });
      // security-scanner-ignore: Using parameterized sql template literal - payload is safely passed as parameter
      await db.execute(sql`SELECT pg_notify('job_queued', ${payload})`);
      console.log(`[BackgroundJobQueue] Sent NOTIFY for job ${job.id}`);
    } catch (error) {
      console.error(`[BackgroundJobQueue] Failed to send NOTIFY for job ${job.id}:`, error);
    }
    
    // Start processing if this is a worker VM
    this.startProcessing();
    
    return job;
  }

  /**
   * Queue multiple jobs in batch
   */
  async queueBatchJobs(jobs: Array<{
    userId: number;
    jobType: JobType;
    metadata?: JobMetadata;
    priority?: number;
  }>): Promise<MatchGenerationJob[]> {
    console.log(`[BackgroundJobQueue] Queueing ${jobs.length} batch jobs`);
    
    const results = [];
    for (const job of jobs) {
      const queuedJob = await this.queueJob(
        job.userId,
        job.jobType,
        job.metadata || {},
        job.priority || 5
      );
      results.push(queuedJob);
    }
    
    return results;
  }

  /**
   * Get pending jobs sorted by priority and creation time
   * @param limit - Maximum number of jobs to fetch
   * @param maxPriority - Optional maximum priority to filter jobs (inclusive)
   */
  async getPendingJobs(limit = 10, maxPriority?: number): Promise<MatchGenerationJob[]> {
    if (maxPriority !== undefined) {
      return this.storage.getPendingMatchGenerationJobsByPriority(limit, maxPriority);
    }
    return this.storage.getPendingMatchGenerationJobs(limit);
  }

  /**
   * Update job status
   */
  async updateJobStatus(
    jobId: number,
    status: JobStatus,
    result?: JobResult,
    expectedStatus?: JobStatus
  ): Promise<void> {
    const updates: Partial<MatchGenerationJob> = {
      status,
      ...result?.error && { errorMessage: result.error },
      ...status === 'PROCESSING' && { startedAt: new Date().toISOString() },
      ...(['COMPLETED', 'FAILED'].includes(status)) && { completedAt: new Date().toISOString() }
    };

    await this.storage.updateMatchGenerationJob(jobId, updates, expectedStatus);
    console.log(`[BackgroundJobQueue] Updated job ${jobId} status to ${status}`);
  }

  /**
   * Mark job as failed and potentially retry
   */
  async failJob(jobId: number, error: string): Promise<boolean> {
    const job = await this.storage.getMatchGenerationJob(jobId);
    if (!job) return false;

    const safeError = error
      .replace(/https?:\/\/\S+/gi, '[redacted-url]')
      .replace(/(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '[redacted]')
      .slice(0, 500);
    const shouldRetry = job.retryCount < job.maxRetries;
    
    if (shouldRetry) {
      await this.storage.updateMatchGenerationJob(jobId, {
        status: 'RETRYING',
        retryCount: job.retryCount + 1,
        errorMessage: safeError
      }, job.status);
      console.log(`[BackgroundJobQueue] Job ${jobId} will retry (attempt ${job.retryCount + 1}/${job.maxRetries})`);
      return true;
    } else {
      console.log(`[DeadLetter] Job ${jobId} moved to dead letter queue after ${job.retryCount} failed attempts`);
      if (job.status === 'PROCESSING') {
        await this.storage.moveJobToDeadLetterQueue(jobId, safeError);
      }
      return false;
    }
  }

  /**
   * Cancel jobs for a specific user when their profile is updated
   */
  async cancelStaleJobsForUser(userId: number, newProfileVersion: number): Promise<number> {
    console.log(`[BackgroundJobQueue] Cancelling stale jobs for user ${userId} (new profile version: ${newProfileVersion})`);
    
    const allPendingJobs = await this.storage.getPendingMatchGenerationJobs(100);
    const pendingJobs = allPendingJobs.filter(job => 
      job.userId === userId || JSON.parse(job.metadata || '{}').targetUserId === userId
    );
    let cancelledCount = 0;
    
    for (const job of pendingJobs) {
      try {
        const metadata = JSON.parse(job.metadata || '{}') as JobMetadata;
        
        // Cancel if job was created with an older profile version
        if (metadata.userProfileVersion && metadata.userProfileVersion < newProfileVersion) {
          await this.updateJobStatus(job.id, 'CANCELLED');
          cancelledCount++;
          console.log(`[BackgroundJobQueue] Cancelled stale job ${job.id} (profile version ${metadata.userProfileVersion} < ${newProfileVersion})`);
        }
        
        // Also cancel jobs where this user is the target and their profile version is stale
        if (metadata.targetUserId === userId && metadata.targetUserProfileVersion && metadata.targetUserProfileVersion < newProfileVersion) {
          await this.updateJobStatus(job.id, 'CANCELLED');
          cancelledCount++;
          console.log(`[BackgroundJobQueue] Cancelled stale job ${job.id} (target profile version ${metadata.targetUserProfileVersion} < ${newProfileVersion})`);
        }
      } catch (error) {
        console.error(`[BackgroundJobQueue] Error processing job ${job.id} for cancellation:`, error);
      }
    }
    
    console.log(`[BackgroundJobQueue] Cancelled ${cancelledCount} stale jobs for user ${userId}`);
    return cancelledCount;
  }

  /**
   * Cancel specific job by ID
   */
  async cancelJob(jobId: number, reason: string = 'Cancelled by system'): Promise<boolean> {
    const job = await this.storage.getMatchGenerationJob(jobId);
    if (!job) return false;

    if (['PENDING', 'RETRYING'].includes(job.status)) {
      await this.updateJobStatus(jobId, 'CANCELLED', { success: false, error: reason });
      console.log(`[BackgroundJobQueue] Cancelled job ${jobId}: ${reason}`);
      return true;
    }
    
    return false;
  }

  /**
   * Check if a job is stale based on current profile versions and match justifications
   */
  private async isJobStale(job: MatchGenerationJob, metadata: JobMetadata): Promise<boolean> {
    try {
      // Skip staleness check for non-match jobs
      if (job.jobType !== 'MATCH_DESCRIPTION') {
        return false;
      }

      const userId = job.userId;
      const targetUserId = metadata.targetUserId;
      
      if (!targetUserId) {
        return false;
      }

      // Get current profile versions
      const [currentUser, currentTargetUser] = await Promise.all([
        this.storage.getUser(userId),
        this.storage.getUser(targetUserId)
      ]);

      if (!currentUser || !currentTargetUser) {
        console.log(`[BackgroundJobQueue] User not found for job ${job.id}, marking as stale`);
        return true;
      }

      // Check if profile versions have changed since job creation
      const userProfileVersion = currentUser.profileVersion;
      const targetUserProfileVersion = currentTargetUser.profileVersion;

      if (metadata.userProfileVersion == null || metadata.userProfileVersion !== userProfileVersion) {
        console.log(`[BackgroundJobQueue] Job ${job.id} is stale: source profile version is missing or differs from current ${userProfileVersion}`);
        return true;
      }

      if (metadata.targetUserProfileVersion == null || metadata.targetUserProfileVersion !== targetUserProfileVersion) {
        console.log(`[BackgroundJobQueue] Job ${job.id} is stale: target profile version is missing or differs from current ${targetUserProfileVersion}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`[BackgroundJobQueue] Error checking job staleness for job ${job.id}:`, error);
      // On error, assume job is stale to be safe
      return true;
    }
  }

  /**
   * Start background processing if not already running
   * Only starts if RUN_CMDCC_WORKER=true (worker VM mode)
   */
  private startProcessing(): void {
    if (this.isProcessing && this.processingPromise) return;
    
    // Only process jobs if this is a worker VM
    if (!this.shouldProcessJobs()) {
      console.log('[BackgroundJobQueue] Job queued but processing disabled (not a worker VM)');
      return;
    }
    
    this.isProcessing = true;
    this.processingPromise = this.processJobs();
  }

  /**
   * Claim the next pending job atomically
   * Returns null if no jobs available
   * Priority order: high-priority (≤5) first, then low-priority
   */
  private async claimNextJob(): Promise<MatchGenerationJob | null> {
    try {
      // First try to claim high-priority jobs (priority ≤ 5) atomically
      let job = await this.storage.claimPendingJob(this.HIGH_PRIORITY_THRESHOLD);
      
      if (!job) {
        // No high-priority jobs, try to claim low-priority jobs atomically
        job = await this.storage.claimPendingJob();
      }
      if (job) recordQueueEvent('jobs', 'claimed');
      return job;
    } catch (error) {
      console.error('[BackgroundJobQueue] Error claiming job:', error);
      return null;
    }
  }

  /**
   * Event-driven worker that waits for notifications
   * Each worker waits for NOTIFY events (or fallback timeout) instead of polling
   */
  private async worker(workerId: number): Promise<void> {
    console.log(`[EventDriven] Worker ${workerId} started (event-driven mode)`);
    
    while (this.isProcessing) {
      try {
        // Wait for job notification or fallback timeout
        await this.waitForJobNotification();
        
        // Try to claim a job atomically
        const job = await this.claimNextJob();
        
        if (!job) {
          // No job available - another worker claimed it, or false alarm
          // Immediately go back to waiting (no backoff needed in event-driven mode)
          continue;
        }
        
        // Job claimed successfully
        console.log(`[EventDriven] Worker ${workerId} claimed job ${job.id}`);
        
        // Process the job
        await this.processJob(job, workerId);
        
      } catch (error) {
        console.error(`[EventDriven] Worker ${workerId} error:`, error);
        // Wait before retrying to prevent tight error loops
        await this.sleep(5000);
      }
    }
    
    console.log(`[EventDriven] Worker ${workerId} stopped`);
  }

  /**
   * Start worker pool with continuous job processing
   * Each worker independently claims and processes jobs
   * Uses dynamic concurrency up to MAX_CONCURRENT_WORKERS (50 for Tier 1)
   * Rate limiting is handled automatically by the Anthropic wrapper
   */
  private async processJobs(): Promise<void> {
    console.log(`[BackgroundJobQueue] Starting worker pool with ${this.MAX_CONCURRENT_WORKERS} concurrent workers (rate-limited automatically)`);
    
    const workers = [];
    for (let i = 0; i < this.MAX_CONCURRENT_WORKERS; i++) {
      workers.push(this.worker(i));
    }
    
    await Promise.all(workers);
    
    console.log('[BackgroundJobQueue] Worker pool stopped');
  }

  /**
   * Process a single job
   */
  private async processJob(job: MatchGenerationJob, workerId?: number): Promise<void> {
    const workerPrefix = workerId !== undefined ? `[Worker ${workerId}] ` : '';
    const startTime = Date.now();
    const jobCreatedAt = new Date(job.createdAt).getTime();
    const enqueueDelay = startTime - jobCreatedAt;
    
    try {
      console.log(`${workerPrefix}Job ${job.id} (priority ${job.priority}) enqueued ${enqueueDelay}ms ago, starting processing (${job.jobType})`);
      
      // Check if job is cancelled before processing
      if (job.status === 'CANCELLED') {
        console.log(`${workerPrefix}Skipping cancelled job ${job.id}`);
        return;
      }
      
      const metadata: JobMetadata = job.metadata ? JSON.parse(job.metadata) : {};
      
      // Perform staleness check before processing
      const isStale = await this.isJobStale(job, metadata);
      if (isStale) {
        console.log(`${workerPrefix}Job ${job.id} is stale, cancelling`);
        await this.updateJobStatus(job.id, 'CANCELLED', { 
          success: false, 
          error: 'Job cancelled due to stale profile data or match justification' 
        }, 'PROCESSING');
        return;
      }
      
      let result: JobResult;
      
      switch (job.jobType) {
        case 'MATCH_DESCRIPTION':
          result = await this.processMatchDescription(job.userId, metadata);
          break;
        case 'BATCH_PROFILES':
          result = await this.processBatchProfiles(job.userId, metadata);
          break;
        case 'USER_PROFILE_UPDATE':
          result = await this.processUserProfileUpdate(job.userId, metadata);
          break;
        default:
          throw new Error(`Unknown job type: ${job.jobType}`);
      }
      
      const processingTime = Date.now() - startTime;
      const totalTime = Date.now() - jobCreatedAt;
      result.processingTime = processingTime;
      
      console.log(`${workerPrefix}Job ${job.id} completed in ${processingTime}ms (total ${totalTime}ms from enqueue)`);
      
      if (result.success) {
        await this.updateJobStatus(job.id, 'COMPLETED', result, 'PROCESSING');
        
        await this.checkAndNotifyMatchesReady(job.userId);
      } else {
        await this.failJob(job.id, result.error || 'Processing failed');
      }
      
    } catch (error) {
      console.error(`${workerPrefix}Error processing job ${job.id}:`, error);
      await this.failJob(job.id, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Process match description generation job
   * 
   * NOTE: AI processing is isolated to Worker VM for security.
   * The main app only queues jobs - Worker VM handles processing.
   */
  private async processMatchDescription(userId: number, metadata: JobMetadata): Promise<JobResult> {
    void userId;
    void metadata;
    console.warn(`[BackgroundJobQueue] Main app should NOT process jobs - Worker VM handles AI processing`);
    return {
      success: false,
      error: 'Job processing is disabled in main app - Worker VM handles all AI processing'
    };
  }

  /**
   * Process batch profile updates
   * 
   * NOTE: AI processing is isolated to Worker VM for security.
   * The main app only queues jobs - Worker VM handles processing.
   */
  private async processBatchProfiles(userId: number, metadata: JobMetadata): Promise<JobResult> {
    void userId;
    void metadata;
    console.warn(`[BackgroundJobQueue] Main app should NOT process jobs - Worker VM handles AI processing`);
    return {
      success: false,
      error: 'Job processing is disabled in main app - Worker VM handles all AI processing'
    };
  }

  /**
   * Process user profile update
   * 
   * NOTE: AI processing is isolated to Worker VM for security.
   * The main app only queues jobs - Worker VM handles processing.
   */
  private async processUserProfileUpdate(userId: number, metadata: JobMetadata): Promise<JobResult> {
    void userId;
    void metadata;
    console.warn(`[BackgroundJobQueue] Main app should NOT process jobs - Worker VM handles AI processing`);
    return {
      success: false,
      error: 'Job processing is disabled in main app - Worker VM handles all AI processing'
    };
  }

  /**
   * Get job statistics
   */
  async getJobStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    return this.storage.getMatchGenerationJobStats();
  }

  /**
   * Clean up old completed/failed jobs
   */
  async cleanupOldJobs(olderThanDays = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    return this.storage.deleteOldMatchGenerationJobs(cutoffDate.toISOString());
  }

  /**
   * Start the job processing loop (for server startup)
   * Only starts if RUN_CMDCC_WORKER=true (worker VM mode)
   */
  async start(): Promise<void> {
    this.isStopping = false;
    if (this.shouldProcessJobs()) {
      console.log(`[EventDriven] Starting event-driven background processing (Worker VM mode)`);
      
      // Set up LISTEN connection for event-driven processing
      this.isProcessing = true;
      await this.storage.recoverStaleQueueWork(new Date(Date.now() - 5 * 60_000).toISOString());
      await this.setupListenConnection();
      
      // Start worker pool
      this.startProcessing();
    } else {
      console.log(`[BackgroundJobQueue] Job processing disabled (Main app mode - jobs will be queued only)`);
    }
  }

  /**
   * Stop the job processing loop and cleanup LISTEN connection
   */
  async stop(): Promise<void> {
    console.log(`[EventDriven] Stopping job processing`);
    this.isStopping = true;
    this.isProcessing = false;
    
    // Wake all workers so they can exit cleanly
    this.wakeAllWorkers();
    
    if (this.processingPromise) {
      await this.processingPromise;
      this.processingPromise = null;
    }
    
    // Clean up LISTEN connection
    this.listenClient = null;
    if (this.listenPool) {
      console.log('[EventDriven] Closing LISTEN connection');
      try {
        await this.listenPool.end();
      } catch (error) {
        logger.error('[EventDriven] Error closing LISTEN connection:', error);
      }
      this.listenPool = null;
    }
    
    console.log('[EventDriven] Background processing stopped');
  }

  /**
   * Check if all high-priority jobs for a user are complete and notify if ready
   * This is called after each successful job completion
   */
  private async checkAndNotifyMatchesReady(userId: number): Promise<void> {
    try {
      // Query ONLY for this user's pending high-priority jobs (not all users)
      // This was the bug: previously queried all users, so notification never fired
      const userPendingJobs = await db
        .select()
        .from(matchGenerationJobs)
        .where(and(
          eq(matchGenerationJobs.userId, userId),
          or(
            eq(matchGenerationJobs.status, 'PENDING'),
            eq(matchGenerationJobs.status, 'PROCESSING'),
            eq(matchGenerationJobs.status, 'RETRYING')
          ),
          lte(matchGenerationJobs.priority, this.HIGH_PRIORITY_THRESHOLD)
        ));
      
      const pendingCount = userPendingJobs.length;
      
      if (pendingCount === 0) {
        // CRITICAL FIX: Verify all matches are actually READY in database before notifying
        // Checking job status alone isn't enough - we must confirm database writes are complete
        // Query the match table directly to ensure no GENERATING matches exist
        const generatingMatches = await db
          .select({ id: synergyMatches.id })
          .from(synergyMatches)
          .where(and(
            eq(synergyMatches.userId, userId),
            eq(synergyMatches.generationStatus, 'GENERATING')
          ));
        
        if (generatingMatches.length > 0) {
          console.log(`[MatchesReady] User ${userId} has ${generatingMatches.length} matches still GENERATING, waiting...`);
          return;
        }
        
        // Double-check: ensure we have at least one READY match (sanity check)
        const readyMatches = await db
          .select({ id: synergyMatches.id })
          .from(synergyMatches)
          .where(and(
            eq(synergyMatches.userId, userId),
            eq(synergyMatches.generationStatus, 'READY')
          ));
        
        if (readyMatches.length === 0) {
          console.log(`[MatchesReady] User ${userId} has no READY matches yet, skipping notification`);
          return;
        }
        
        console.log(`[MatchesReady] All high-priority jobs completed AND all ${readyMatches.length} matches are READY for user ${userId}, emitting NOTIFY`);
        
        // Emit PostgreSQL NOTIFY for future event-driven architecture
        // security-scanner-ignore: Using parameterized sql template literal - payload is safely passed as parameter
        const payload = JSON.stringify({ userId, timestamp: new Date().toISOString() });
        await db.execute(sql`SELECT pg_notify('matches_ready', ${payload})`);
        
        // Write to callback_notification_queue for main app's callback processor
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes from now
        await db.insert(callbackNotificationQueue).values({
          userId,
          notificationType: 'matchRefresh',
          payload: JSON.stringify({ userIds: [userId], reason: 'matches_ready' }),
          priority: 1, // High priority
          expiresAt,
          status: 'pending'
        });
        
        console.log(`[MatchesReady] ✅ Successfully emitted matches_ready notification and queued callback for user ${userId}`);
      } else {
        console.log(`[MatchesReady] User ${userId} still has ${pendingCount} pending high-priority job(s), not notifying yet`);
      }
    } catch (error) {
      console.error(`[MatchesReady] Error checking/notifying matches ready for user ${userId}:`, error);
    }
  }

  /**
   * Utility sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      // Backoff timers must not keep a draining worker process alive.
      timer.unref?.();
    });
  }
}

/**
 * Extract profile data from a User object for snapshot creation
 */
export function extractProfileData(user: User): ProfileData {
  return {
    bio: user.bio,
    title: user.title,
    currentLocation: user.currentLocation,
    currentLocationLat: user.currentLocationLat,
    currentLocationLng: user.currentLocationLng,
    industry: user.industry,
    currentCompany: user.currentCompany,
    desiredLocations: user.desiredLocations,
    desiredCompanies: user.desiredCompanies,
    interests: user.interests,
    professionalInterests: user.professionalInterests,
    languages: user.languages,
    matchingRadius: user.matchingRadius,
    yearsOfExperience: user.yearsOfExperience,
    educationLevel: user.educationLevel,
    institution: user.institution,
  };
}

// Global job queue instance
let jobQueueInstance: BackgroundJobQueue | null = null;

export function getJobQueue(storage: IStorage): BackgroundJobQueue {
  if (!jobQueueInstance) {
    jobQueueInstance = new BackgroundJobQueue(storage);
  }
  return jobQueueInstance;
}

// Export singleton instance for convenience
import { storage } from '../storage';
export const backgroundJobQueue = getJobQueue(storage);