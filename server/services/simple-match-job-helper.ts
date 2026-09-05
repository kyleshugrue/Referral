import type { IStorage } from '../storage';
import type { JobMetadata, JobType } from './background-job-queue';

export interface InitialMatchJobFailure {
  userId: number;
  targetUserId: number;
  priority: number;
}

export interface InitialMatchJobsResult {
  highPriorityJobs: number;
  lowPriorityJobs: number;
  potentialMatches: number;
  requiredDirections: number;
  representedDirections: number;
  failedDirections: InitialMatchJobFailure[];
  complete: boolean;
}

type QueueJob = (
  userId: number,
  jobType: JobType,
  metadata: JobMetadata,
  priority: number,
  maxRetries: number,
) => Promise<unknown>;

/**
 * Simple Match Job Helper
 * 
 * Provides job queuing functionality for match generation WITHOUT AI processing.
 * All AI processing is isolated to the Worker VM for security.
 * 
 * This helper only queues jobs - the Worker VM handles:
 * - Compatibility checking
 * - AI match description generation
 * - Match scoring
 */

export class SimpleMatchJobHelper {
  private storage: IStorage;
  private readonly queueJob?: QueueJob;

  constructor(storage: IStorage, queueJob?: QueueJob) {
    this.storage = storage;
    this.queueJob = queueJob;
  }

  /**
   * Queue prioritized match jobs for a user
   * Finds potential matches and queues jobs for Worker VM to process
   * 
   * HIGH priority (1): Viewing user's descriptions (what they see about matches)
   * LOW priority (9): Matched users' descriptions (what matched users see about viewing user)
   */
  async queuePrioritizedMatchJobs(viewingUserId: number): Promise<InitialMatchJobsResult> {
    try {
      console.log(`[SimpleMatchJobHelper] Queueing prioritized match jobs for user ${viewingUserId}`);

      // Get current user
      const viewingUser = await this.storage.getUser(viewingUserId);
      if (!viewingUser) {
        throw new Error(`User ${viewingUserId} not found`);
      }

      // Find all potential matching user IDs
       const potentialMatchIds = await this.storage.findPotentialMatchUserIds(viewingUserId);
      console.log(`[SimpleMatchJobHelper] Found ${potentialMatchIds.length} potential matches for user ${viewingUserId}`);

      if (potentialMatchIds.length === 0) {
        return {
          highPriorityJobs: 0,
          lowPriorityJobs: 0,
          potentialMatches: 0,
          requiredDirections: 0,
          representedDirections: 0,
          failedDirections: [],
          complete: true,
        };
      }

      const enqueue = this.queueJob ?? (async (...args: Parameters<QueueJob>) => {
        const { backgroundJobQueue } = await import('./background-job-queue');
        return backgroundJobQueue.queueJob(...args);
      });

      let highPriorityCount = 0;
      let lowPriorityCount = 0;
      let requiredDirections = 0;
      const failedDirections: InitialMatchJobFailure[] = [];

      // Queue jobs for all potential matches - Worker VM will handle compatibility checking
      for (const matchedUserId of potentialMatchIds) {
        try {
          // Get matched user
          const matchedUser = await this.storage.getUser(matchedUserId);
          if (!matchedUser) {
            console.log(`[SimpleMatchJobHelper] Skipping user ${matchedUserId} - not found`);
            failedDirections.push(
              { userId: viewingUserId, targetUserId: matchedUserId, priority: 1 },
              { userId: matchedUserId, targetUserId: viewingUserId, priority: 9 },
            );
            requiredDirections += 2;
            continue;
          }

          requiredDirections += 2;

          // HIGH PRIORITY: Create job for viewing user's perspective (A→B)
          try {
            await enqueue(
              viewingUserId,
              'MATCH_DESCRIPTION',
              {
                userId: viewingUserId,
                targetUserId: matchedUserId,
                userProfileVersion: viewingUser.profileVersion,
                priority: 1
              },
              1,
              5
            );
            highPriorityCount++;
          } catch (error) {
            console.error(`[SimpleMatchJobHelper] Error queuing high-priority job for ${viewingUserId}→${matchedUserId}:`, error);
            failedDirections.push({ userId: viewingUserId, targetUserId: matchedUserId, priority: 1 });
          }

          // LOW PRIORITY: Create job for matched user's perspective (B→A)
          try {
            await enqueue(
              matchedUserId,
              'MATCH_DESCRIPTION',
              {
                userId: matchedUserId,
                targetUserId: viewingUserId,
                userProfileVersion: matchedUser.profileVersion,
                priority: 9
              },
              9,
              5
            );
            lowPriorityCount++;
          } catch (error) {
            console.error(`[SimpleMatchJobHelper] Error queuing low-priority job for ${matchedUserId}→${viewingUserId}:`, error);
            failedDirections.push({ userId: matchedUserId, targetUserId: viewingUserId, priority: 9 });
          }
        } catch (error) {
          console.error(`[SimpleMatchJobHelper] Error processing potential match ${matchedUserId}:`, error);
        }
      }

      console.log(`[SimpleMatchJobHelper] Queued ${highPriorityCount} high-priority and ${lowPriorityCount} low-priority jobs for ${potentialMatchIds.length} potential matches`);

      return { 
        highPriorityJobs: highPriorityCount, 
        lowPriorityJobs: lowPriorityCount,
        potentialMatches: potentialMatchIds.length,
        requiredDirections,
        representedDirections: requiredDirections - failedDirections.length,
        failedDirections,
        complete: failedDirections.length === 0,
      };

    } catch (error) {
      console.error(`[SimpleMatchJobHelper] Error queueing prioritized match jobs:`, error);
      throw error;
    }
  }
}

// Export singleton instance
import { storage } from '../storage';
export const simpleMatchJobHelper = new SimpleMatchJobHelper(storage);
