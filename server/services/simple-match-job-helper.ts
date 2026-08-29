import type { IStorage } from '../storage';

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

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Queue prioritized match jobs for a user
   * Finds potential matches and queues jobs for Worker VM to process
   * 
   * HIGH priority (1): Viewing user's descriptions (what they see about matches)
   * LOW priority (9): Matched users' descriptions (what matched users see about viewing user)
   */
  async queuePrioritizedMatchJobs(viewingUserId: number): Promise<{ 
    highPriorityJobs: number; 
    lowPriorityJobs: number; 
    potentialMatches: number;
  }> {
    try {
      console.log(`[SimpleMatchJobHelper] Queueing prioritized match jobs for user ${viewingUserId}`);

      // Get current user
      const viewingUser = await this.storage.getUser(viewingUserId);
      if (!viewingUser) {
        throw new Error(`User ${viewingUserId} not found`);
      }

      // Find all potential matching user IDs
      const potentialMatchIds = await this.storage.findUsersMatchingWithUser(viewingUserId);
      console.log(`[SimpleMatchJobHelper] Found ${potentialMatchIds.length} potential matches for user ${viewingUserId}`);

      if (potentialMatchIds.length === 0) {
        return { highPriorityJobs: 0, lowPriorityJobs: 0, potentialMatches: 0 };
      }

      // Import background job queue
      const { backgroundJobQueue } = await import('./background-job-queue');

      let highPriorityCount = 0;
      let lowPriorityCount = 0;

      // Queue jobs for all potential matches - Worker VM will handle compatibility checking
      for (const matchedUserId of potentialMatchIds) {
        try {
          // Get matched user
          const matchedUser = await this.storage.getUser(matchedUserId);
          if (!matchedUser) {
            console.log(`[SimpleMatchJobHelper] Skipping user ${matchedUserId} - not found`);
            continue;
          }

          // HIGH PRIORITY: Create job for viewing user's perspective (A→B)
          try {
            await backgroundJobQueue.queueJob(
              viewingUserId,
              'MATCH_DESCRIPTION',
              {
                userId: viewingUserId,
                targetUserId: matchedUserId,
                userProfileVersion: viewingUser.profileVersion || 1,
                priority: 1
              },
              1,
              5
            );
            highPriorityCount++;
          } catch (error) {
            console.error(`[SimpleMatchJobHelper] Error queuing high-priority job for ${viewingUserId}→${matchedUserId}:`, error);
          }

          // LOW PRIORITY: Create job for matched user's perspective (B→A)
          try {
            await backgroundJobQueue.queueJob(
              matchedUserId,
              'MATCH_DESCRIPTION',
              {
                userId: matchedUserId,
                targetUserId: viewingUserId,
                userProfileVersion: matchedUser.profileVersion || 1,
                priority: 9
              },
              9,
              5
            );
            lowPriorityCount++;
          } catch (error) {
            console.error(`[SimpleMatchJobHelper] Error queuing low-priority job for ${matchedUserId}→${viewingUserId}:`, error);
          }
        } catch (error) {
          console.error(`[SimpleMatchJobHelper] Error processing potential match ${matchedUserId}:`, error);
        }
      }

      console.log(`[SimpleMatchJobHelper] Queued ${highPriorityCount} high-priority and ${lowPriorityCount} low-priority jobs for ${potentialMatchIds.length} potential matches`);

      return { 
        highPriorityJobs: highPriorityCount, 
        lowPriorityJobs: lowPriorityCount,
        potentialMatches: potentialMatchIds.length
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
