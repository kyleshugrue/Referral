import { storage } from '../storage.js';
import { User, SynergyMatch, synergyMatches } from '../../shared/schema.js';
import { backgroundJobQueue } from './background-job-queue.js';
import { analyzeStaleMatches } from './stale-match-analyzer.js';
import { db } from '../db.js';
import { eq } from 'drizzle-orm';

/**
 * Centralized Match & Description Command Center (CMDCC)
 * 
 * CRITICAL REQUIREMENT: Users must NEVER see stale descriptions or matches
 * 
 * This service provides:
 * - Unified state management for matches and descriptions
 * - Real-time validation of match justifications
 * - Instant profile update propagation
 * - Centralized staleness detection and cleanup
 * - Atomic consistency across match and description operations
 */

export interface MatchValidationResult {
  isValid: boolean;
  reason?: string;
  staleFields?: string[];
  profileVersionMismatch?: boolean;
}

export interface CMDCCOperationResult {
  success: boolean;
  staleBefore: number;
  staleAfter: number;
  processedMatches: number;
  generatedDescriptions: number;
  deletedStaleContent: number;
  errors: string[];
  validationResults: MatchValidationResult[];
}

export interface UserMatchValidationResult {
  validMatches: SynergyMatch[];
  invalidMatches: SynergyMatch[];
  totalMatches: number;
  validationResults: MatchValidationResult[];
  staleness: {
    hasStaleMatches: boolean;
    staleReasons: string[];
  };
}

class CentralizedMatchDescriptionCommandCenter {
  private readonly VALIDATION_TIMEOUT_MS = 5000;

  /**
   * Validates if a match is still valid based on current user profiles
   * Checks all match justifications against current user data
   */
  async validateMatchJustification(
    user1: User, 
    user2: User, 
    match: SynergyMatch
  ): Promise<MatchValidationResult> {
    try {
      // Check profile version consistency
      if (match.userProfileVersion !== user1.profileVersion || 
          match.matchedUserProfileVersion !== user2.profileVersion) {
        return {
          isValid: false,
          reason: 'Profile version mismatch detected',
          profileVersionMismatch: true,
          staleFields: ['profileVersion']
        };
      }

      const staleFields: string[] = [];
      
      // Parse match reasons to check against current data
      const justifications = match.matchReasons || [];
      
      for (const justification of justifications) {
        switch (justification) {
          case 'company_priority_bidirectional':
            // Check if users still want each other's companies
            if (!user1.desiredCompanies?.includes(user2.currentCompany!) ||
                !user2.desiredCompanies?.includes(user1.currentCompany!)) {
              staleFields.push('desiredCompanies', 'currentCompany');
            }
            break;
            
          case 'location_priority_bidirectional':
            // Check if users still want each other's locations
            if (!user1.desiredLocations?.includes(user2.currentLocation!) ||
                !user2.desiredLocations?.includes(user1.currentLocation!)) {
              staleFields.push('desiredLocations', 'currentLocation');
            }
            break;
            
          case 'location_company_priority_bidirectional': {
            // Check both location and company bidirectional matches
            const companyMismatch = !user1.desiredCompanies?.includes(user2.currentCompany!) ||
                                  !user2.desiredCompanies?.includes(user1.currentCompany!);
            const locationMismatch = !user1.desiredLocations?.includes(user2.currentLocation!) ||
                                   !user2.desiredLocations?.includes(user1.currentLocation!);
            
            if (companyMismatch) {
              staleFields.push('desiredCompanies', 'currentCompany');
            }
            if (locationMismatch) {
              staleFields.push('desiredLocations', 'currentLocation');
            }
            break;
          }
            
          case 'industry_match':
            // Check if users are still in same industry
            if (user1.industry !== user2.industry) {
              staleFields.push('industry');
            }
            break;
            
          case 'senior_mentorship': {
            // Check if experience gap still exists for mentorship
            const experienceGap = Math.abs((user1.yearsOfExperience || 0) - (user2.yearsOfExperience || 0));
            if (experienceGap < 8) {
              staleFields.push('yearsOfExperience');
            }
            break;
          }
            
          default:
            console.warn(`[CMDCC] Unknown justification type: ${justification}`);
        }
      }

      // Match is stale if any justifications are no longer valid
      if (staleFields.length > 0) {
        return {
          isValid: false,
          reason: `Match justifications no longer valid: ${justifications.join(', ')}`,
          staleFields: [...new Set(staleFields)]
        };
      }

      return { isValid: true };

    } catch (error) {
      console.error('[CMDCC] Error validating match justification:', error);
      return {
        isValid: false,
        reason: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * READ-ONLY validation of user matches without any state mutation
   * Returns validation results without modifying match data or profile versions
   */
  async validateUserMatches(userId: number): Promise<UserMatchValidationResult> {
    console.log(`[CMDCC] Read-only validation for user ${userId} matches`);
    
    try {
      // Get current user data
      const user = await storage.getUser(userId);
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Get all matches for this user (READ-ONLY)
      const allMatches = await storage.getSavedSynergyMatches(userId);
      console.log(`[CMDCC] Found ${allMatches.length} matches for user ${userId}`);

      const validMatches: SynergyMatch[] = [];
      const invalidMatches: SynergyMatch[] = [];
      const validationResults: MatchValidationResult[] = [];

      // Validate each match without any mutations
      for (const match of allMatches) {
        const otherUserId = match.userId === userId ? match.matchedUserId : match.userId;
        const otherUser = await storage.getUser(otherUserId);
        
        if (!otherUser) {
          console.warn(`[CMDCC] Other user ${otherUserId} not found for match ${match.id}`);
          const validation = {
            isValid: false,
            reason: `Other user ${otherUserId} not found`
          };
          invalidMatches.push(match);
          validationResults.push(validation);
          continue;
        }

        // Determine user order for validation
        const [user1, user2] = match.userId === userId ? [user, otherUser] : [otherUser, user];

        // Validate match justification (READ-ONLY)
        const validation = await this.validateMatchJustification(user1, user2, match);
        validationResults.push(validation);

        if (validation.isValid) {
          validMatches.push(match);
        } else {
          console.log(`[CMDCC] Match ${match.id} is stale: ${validation.reason}`);
          invalidMatches.push(match);
        }
      }

      // Collect stale reasons
      const staleReasons = validationResults
        .filter(v => !v.isValid && v.reason)
        .map(v => v.reason!)
        .filter(Boolean);

      return {
        validMatches,
        invalidMatches,
        totalMatches: allMatches.length,
        validationResults,
        staleness: {
          hasStaleMatches: invalidMatches.length > 0,
          staleReasons
        }
      };

    } catch (error) {
      console.error('[CMDCC] Error validating user matches:', error);
      throw error;
    }
  }

  /**
   * Processes profile updates and propagates changes across all affected matches and descriptions
   * Ensures instant staleness detection when user profiles change
   */
  async processProfileUpdate(userId: number, changes: string[] = []): Promise<CMDCCOperationResult> {
    console.log(`[CMDCC] Processing profile update for user ${userId}`);
    console.log(`[CMDCC] Profile changes:`, changes);
    
    const result: CMDCCOperationResult = {
      success: false,
      staleBefore: 0,
      staleAfter: 0,
      processedMatches: 0,
      generatedDescriptions: 0,
      deletedStaleContent: 0,
      errors: [],
      validationResults: []
    };

    try {
      // Step 1: Increment user profile version (atomic)
      const updatedUser = await storage.incrementUserProfileVersion(userId);
      console.log(`[CMDCC] Updated user ${userId} profile version to ${updatedUser.profileVersion}`);

      // Step 2: Cancel any pending/stale background jobs
      const cancelledJobs = await storage.cancelStaleJobsForUser(userId, updatedUser.profileVersion);
      console.log(`[CMDCC] Cancelled ${cancelledJobs} stale background jobs`);

      // Step 3: Mark existing matches as stale
      const staleMarkedCount = await storage.markMatchesStaleForUser(userId, `Profile update: ${changes.join(', ')}`);
      console.log(`[CMDCC] Marked ${staleMarkedCount} matches as stale`);
      result.deletedStaleContent = staleMarkedCount;

      // Step 4: Always queue new background job for fresh match generation after profile update
      // This ensures matches are regenerated even if user had no previous matches
      try {
        const newJob = await backgroundJobQueue.queueJob(
          userId,
          'MATCH_DESCRIPTION',
          {
            userId,
            priority: 5,
            userProfileVersion: updatedUser.profileVersion
          },
          5
        );
        console.log(`[CMDCC] Queued new match generation job ${newJob.id} for profile version ${updatedUser.profileVersion}`);
      } catch (error) {
        console.warn(`[CMDCC] Failed to queue background job:`, error);
        result.errors.push(`Failed to queue background job: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Find all matches involving this user
      const allMatchesWithUser = await storage.getSavedSynergyMatches(userId);
      const allMatches = allMatchesWithUser.map(match => ({
        id: match.id,
        userId: match.userId,
        matchedUserId: match.matchedUserId,
        description: match.description,
        score: match.score,
        matchReasons: match.matchReasons,
        generationStatus: match.generationStatus,
        lastProfileUpdate: match.lastProfileUpdate,
        templateUsed: match.templateUsed,
        userProfileVersion: match.userProfileVersion,
        matchedUserProfileVersion: match.matchedUserProfileVersion,
        scoreEvidence: match.scoreEvidence,
        generationJobKey: match.generationJobKey,
        generationError: match.generationError,
        apiCallsUsed: match.apiCallsUsed,
        createdAt: match.createdAt,
        updatedAt: match.updatedAt
      }));
      result.staleBefore = allMatches.length;

      console.log(`[CMDCC] Found ${allMatches.length} matches for user ${userId}`);

      // Validate each match against current profiles
      const validMatches: SynergyMatch[] = [];
      const staleMatches: SynergyMatch[] = [];

      for (const match of allMatches) {
        const otherUserId = match.userId === userId ? match.matchedUserId : match.userId;
        const otherUser = await storage.getUser(otherUserId);
        
        if (!otherUser) {
          console.warn(`[CMDCC] Other user ${otherUserId} not found for match ${match.id}`);
          staleMatches.push(match);
          continue;
        }

        // Determine user order for validation
        const [user1, user2] = match.userId === userId ? 
          [updatedUser, otherUser] : [otherUser, updatedUser];

        // Validate match justification
        const validation = await this.validateMatchJustification(user1, user2, match);
        result.validationResults.push(validation);
        result.processedMatches++;

        if (validation.isValid) {
          validMatches.push(match);
        } else {
          console.log(`[CMDCC] Match ${match.id} is stale: ${validation.reason}`);
          staleMatches.push(match);
        }
      }

      // Delete stale matches with precise bidirectional cleanup
      for (const staleMatch of staleMatches) {
        // Mark as PENDING for regeneration instead of immediate deletion
        await storage.updateSynergyMatchById(staleMatch.id, {
          generationStatus: 'PENDING',
          updatedAt: new Date().toISOString()
        });
        
        // Enqueue regeneration job for both directions
        await backgroundJobQueue.queueJob(
          staleMatch.userId,
          'MATCH_DESCRIPTION',
          {
            userId: staleMatch.userId,
            targetUserId: staleMatch.matchedUserId,
            userProfileVersion: updatedUser.profileVersion,
            matchReasons: staleMatch.matchReasons || []
          },
          1 // high priority for stale content
        );
        
        result.deletedStaleContent++;
        console.log(`[CMDCC] Marked stale match ${staleMatch.id} for regeneration`);
      }

      // Update profile versions for valid matches (CRITICAL: Actually persist the updates)
      for (const validMatch of validMatches) {
        const updatedMatch = {
          userProfileVersion: validMatch.userId === userId ? updatedUser.profileVersion : validMatch.userProfileVersion,
          matchedUserProfileVersion: validMatch.matchedUserId === userId ? updatedUser.profileVersion : validMatch.matchedUserProfileVersion,
          updatedAt: new Date().toISOString()
        };
        
        // CRITICAL: Actually persist the profile version updates
        await storage.updateSynergyMatchById(validMatch.id, updatedMatch);
        console.log(`[CMDCC] Updated profile versions for valid match ${validMatch.id}`);
      }

      result.staleAfter = validMatches.length;

      console.log(`[CMDCC] Profile update complete: ${result.deletedStaleContent} stale matches deleted, ${validMatches.length} valid matches updated`);

      // Queue background regeneration for valid matches that need new descriptions
      await this.queueDescriptionRegeneration(validMatches, updatedUser);

      // ========== BIDIRECTIONAL MATCH PROPAGATION ==========
      // Step 5: Find all users who have matches with this updated user
      const affectedUserIds = await storage.findUsersMatchingWithUser(userId);
      console.log(`[CMDCC] Found ${affectedUserIds.length} users affected by profile update from user ${userId}`);
      
      if (affectedUserIds.length > 0) {
        // Step 6: Process affected users - mark their matches stale and queue regeneration
        const propagationResults = await this.propagateMatchUpdatesToAffectedUsers(
          affectedUserIds, 
          userId, 
          updatedUser.profileVersion,
          changes
        );
        
        // Add propagation results to main result
        result.deletedStaleContent += propagationResults.totalStaleMarked;
        result.errors.push(...propagationResults.errors);
        
        console.log(`[CMDCC] Bidirectional propagation complete: ${propagationResults.totalStaleMarked} cross-user matches marked stale, ${propagationResults.jobsQueued} regeneration jobs queued`);
        
        // CRITICAL: Send WebSocket notifications to all affected users
        await this.broadcastMatchUpdatesToAffectedUsers(affectedUserIds, userId, updatedUser.profileVersion);
      }

      // CRITICAL: Set success flag after all operations complete
      result.success = true;
      return result;

    } catch (error) {
      console.error('[CMDCC] Error processing profile update:', error);
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      return result;
    }
  }

  /**
   * Performs comprehensive validation across all matches in the system
   * Identifies and removes all stale content to ensure data integrity
   */
  async performSystemWideValidation(): Promise<CMDCCOperationResult> {
    console.log('[CMDCC] Starting system-wide validation');
    
    const result: CMDCCOperationResult = {
      success: false,
      staleBefore: 0,
      staleAfter: 0,
      processedMatches: 0,
      generatedDescriptions: 0,
      deletedStaleContent: 0,
      errors: [],
      validationResults: []
    };

    try {
      // Get all users for profile data
      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(user => [user.id, user]));
      
      // Get all matches in the system
      const allMatchPromises = allUsers.map(async user => {
        const matchesWithUser = await storage.getSavedSynergyMatches(user.id);
        return matchesWithUser.map(match => ({
          id: match.id,
          userId: match.userId,
          matchedUserId: match.matchedUserId,
          description: match.description,
          score: match.score,
          matchReasons: match.matchReasons,
          generationStatus: match.generationStatus,
          lastProfileUpdate: match.lastProfileUpdate,
          templateUsed: match.templateUsed,
          userProfileVersion: match.userProfileVersion,
          matchedUserProfileVersion: match.matchedUserProfileVersion,
          scoreEvidence: match.scoreEvidence,
          generationJobKey: match.generationJobKey,
          generationError: match.generationError,
          apiCallsUsed: match.apiCallsUsed,
          createdAt: match.createdAt,
          updatedAt: match.updatedAt
        }));
      });
      const allMatchArrays = await Promise.all(allMatchPromises);
      
      // Flatten and deduplicate matches
      const allMatches = [...new Map(
        allMatchArrays.flat().map(match => [match.id, match])
      ).values()];
      
      result.staleBefore = allMatches.length;
      console.log(`[CMDCC] Validating ${allMatches.length} total matches`);

      const validMatches: SynergyMatch[] = [];
      const staleMatches: SynergyMatch[] = [];

      // Validate each match
      for (const match of allMatches) {
        const user1 = userMap.get(match.userId);
        const user2 = userMap.get(match.matchedUserId);

        if (!user1 || !user2) {
          console.warn(`[CMDCC] Missing user(s) for match ${match.id}: user1=${!!user1}, user2=${!!user2}`);
          staleMatches.push(match);
          continue;
        }

        const validation = await this.validateMatchJustification(user1, user2, match);
        result.validationResults.push(validation);
        result.processedMatches++;

        if (validation.isValid) {
          validMatches.push(match);
        } else {
          console.log(`[CMDCC] System validation: Match ${match.id} is stale: ${validation.reason}`);
          staleMatches.push(match);
        }
      }

      // Delete all stale matches
      for (const staleMatch of staleMatches) {
        await storage.clearSynergyMatchesForUser(staleMatch.userId);
        result.deletedStaleContent++;
      }

      result.staleAfter = validMatches.length;
      result.success = true;

      console.log(`[CMDCC] System-wide validation complete: ${result.deletedStaleContent} stale matches deleted, ${validMatches.length} valid matches remain`);

      return result;

    } catch (error) {
      console.error('[CMDCC] Error in system-wide validation:', error);
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      return result;
    }
  }

  /**
   * Propagates match updates to all users affected by a profile change
   * Implements bidirectional match invalidation and regeneration
   */
  private async propagateMatchUpdatesToAffectedUsers(
    affectedUserIds: number[], 
    sourceUserId: number, 
    sourceUserProfileVersion: number,
    changes: string[]
  ): Promise<{
    totalStaleMarked: number;
    jobsQueued: number;
    errors: string[];
    notificationsSent: number;
  }> {
    console.log(`[CMDCC] Starting bidirectional propagation for ${affectedUserIds.length} affected users`);
    
    const result = {
      totalStaleMarked: 0,
      jobsQueued: 0,
      errors: [] as string[],
      notificationsSent: 0
    };

    for (const affectedUserId of affectedUserIds) {
      try {
        console.log(`[CMDCC] Processing affected user ${affectedUserId} due to changes in user ${sourceUserId}`);
        
        // Mark matches stale for this affected user (specifically matches with the source user)
        const staleMarkedCount = await storage.markSpecificMatchesStale(
          affectedUserId, 
          sourceUserId, 
          `Cross-user profile update: User ${sourceUserId} changed ${changes.join(', ')}`
        );
        
        result.totalStaleMarked += staleMarkedCount;
        console.log(`[CMDCC] Marked ${staleMarkedCount} matches stale for affected user ${affectedUserId}`);
        
        // Queue match regeneration for affected user if they had stale matches
        if (staleMarkedCount > 0) {
          try {
            const regenerationJob = await backgroundJobQueue.queueJob(
              affectedUserId,
              'MATCH_DESCRIPTION',
              {
                userId: affectedUserId,
                priority: 3, // higher priority for cross-user updates
                userProfileVersion: sourceUserProfileVersion,
                profileUpdated: true
              },
              3 // higher priority
            );
            
            result.jobsQueued++;
            console.log(`[CMDCC] Queued match regeneration job ${regenerationJob.id} for affected user ${affectedUserId}`);
            
            result.notificationsSent++;
            
          } catch (jobError) {
            const errorMsg = `Failed to queue regeneration job for affected user ${affectedUserId}: ${jobError instanceof Error ? jobError.message : 'Unknown error'}`;
            console.warn(`[CMDCC] ${errorMsg}`);
            result.errors.push(errorMsg);
          }
        }
        
      } catch (userError) {
        const errorMsg = `Failed to process affected user ${affectedUserId}: ${userError instanceof Error ? userError.message : 'Unknown error'}`;
        console.warn(`[CMDCC] ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }

    return result;
  }

  /**
   * Broadcasts match updates to all affected users efficiently
   */
  private async broadcastMatchUpdatesToAffectedUsers(
    affectedUserIds: number[], 
    sourceUserId: number, 
    profileVersion: number
  ): Promise<void> {
    try {
      // Import WebSocket utilities
      const { sendToUser } = await import('../websocket-utils');
      
      console.log(`[CMDCC] Broadcasting match updates to ${affectedUserIds.length} affected users`);
      
      // Send notifications in parallel for better performance
      const notificationPromises = affectedUserIds.map(async (affectedUserId) => {
        try {
          const notification = {
            type: 'matchesUpdated',
            userId: affectedUserId,
            sourceUserId,
            profileVersion,
            affectedCount: affectedUserIds.length,
            message: `Your matches have been updated due to profile changes`,
            timestamp: new Date().toISOString()
          };
          
          await sendToUser(affectedUserId, notification);
          console.log(`[CMDCC] Sent WebSocket notification to affected user ${affectedUserId}`);
          
        } catch (error) {
          console.warn(`[CMDCC] Failed to send WebSocket notification to user ${affectedUserId}:`, error);
          // Don't throw - individual notification failure shouldn't break the batch
        }
      });
      
      // Wait for all notifications to complete
      await Promise.allSettled(notificationPromises);
      console.log(`[CMDCC] Completed broadcasting to ${affectedUserIds.length} users`);
      
    } catch (error) {
      console.warn(`[CMDCC] Error in batch WebSocket broadcast:`, error);
      // Don't throw - notification failure shouldn't break the main flow
    }
  }

  /**
   * Sends WebSocket notification to affected user about match updates
   * @deprecated Use broadcastMatchUpdatesToAffectedUsers for better performance
   */
  private async notifyAffectedUser(affectedUserId: number, sourceUserId: number, changes: string[]): Promise<void> {
    try {
      // Import WebSocket utilities
      const { sendToUser } = await import('../websocket-utils');
      
      const notification = {
        type: 'matchesUpdated',
        userId: affectedUserId,
        sourceUserId,
        changes,
        message: `Your matches have been updated due to profile changes by another user`,
        timestamp: new Date().toISOString()
      };
      
      await sendToUser(affectedUserId, notification);
      console.log(`[CMDCC] Sent WebSocket notification to affected user ${affectedUserId}`);
      
    } catch (error) {
      console.warn(`[CMDCC] Failed to send WebSocket notification to user ${affectedUserId}:`, error);
      // Don't throw - notification failure shouldn't break the main flow
    }
  }

  /**
   * Queues background regeneration of descriptions for valid matches
   * Ensures descriptions are updated when profiles change but matches remain valid
   */
  private async queueDescriptionRegeneration(
    validMatches: SynergyMatch[], 
    updatedUser: User
  ): Promise<void> {
    try {
      // Queue regeneration for matches that need updated descriptions
      const regenerationPromises = validMatches
        .filter(match => {
          // Regenerate if match description might be affected by profile changes
          return match.description && 
                 (match.description.includes(updatedUser.currentCompany!) ||
                  match.description.includes(updatedUser.currentLocation!) ||
                  match.description.includes(updatedUser.title!));
        })
        .map(match => {
          return backgroundJobQueue.queueJob(
            updatedUser.id,
            'MATCH_DESCRIPTION',
            {
              userId: updatedUser.id,
              targetUserId: match.matchedUserId,
              userProfileVersion: updatedUser.profileVersion,
              matchReasons: match.matchReasons || [],
              regenerationEpoch: Date.now()
            },
            1 // high priority
          );
        });

      await Promise.all(regenerationPromises);
      console.log(`[CMDCC] Queued ${regenerationPromises.length} description regeneration jobs`);

    } catch (error) {
      console.error('[CMDCC] Error queuing description regeneration:', error);
    }
  }

  /**
   * Handles incremental profile updates by analyzing and updating only stale matches
   * This is the new preferred method that preserves valid matches instead of deleting everything
   */
  async handleIncrementalProfileUpdate(
    userId: number,
    oldProfile: Partial<User>,
    newProfile: Partial<User>
  ): Promise<{ queuedJobId: number | null }> {
    console.log(`[IncrementalUpdate] Starting incremental profile update for user ${userId}`);
    
    try {
      // Step 1: Detect changed fields
      const changedFields: string[] = [];
      const allFields = new Set([...Object.keys(oldProfile), ...Object.keys(newProfile)]);
      
      for (const field of allFields) {
        const fieldName = field as keyof User;
        const oldValue = oldProfile[fieldName];
        const newValue = newProfile[fieldName];
        
        if (Array.isArray(oldValue) || Array.isArray(newValue)) {
          if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            changedFields.push(field);
          }
        } else if (oldValue !== newValue) {
          changedFields.push(field);
        }
      }
      
      console.log(`[IncrementalUpdate] Changed fields:`, changedFields);
      
      if (changedFields.length === 0) {
        console.log(`[IncrementalUpdate] No changes detected, skipping update`);
        return { queuedJobId: null };
      }

      // Step 2: Analyze stale matches using StaleMatchAnalyzer
      const analysis = await analyzeStaleMatches(
        userId,
        {
          oldProfile,
          newProfile,
          changedFields
        },
        storage
      );

      console.log(`[IncrementalUpdate] Match analysis complete:`, {
        valid: analysis.validMatches.length,
        stale: analysis.staleMatches.length,
        needsUpdate: analysis.needsUpdate.length
      });

      // Step 3: Delete only stale matches
      if (analysis.staleMatches.length > 0) {
        console.log(`[IncrementalUpdate] Deleting ${analysis.staleMatches.length} stale matches`);
        
        for (const matchId of analysis.staleMatches) {
          try {
            await db.delete(synergyMatches).where(eq(synergyMatches.id, matchId));
            console.log(`[IncrementalUpdate] Deleted stale match ${matchId}`);
          } catch (error) {
            console.error(`[IncrementalUpdate] Error deleting match ${matchId}:`, error);
          }
        }
      } else {
        console.log(`[IncrementalUpdate] No stale matches to delete`);
      }

      // Step 4: Queue jobs for updating matches
      let firstJobId: number | null = null;
      const queuedJobs: number[] = [];

      // Queue high-priority jobs for matches that need description updates (viewing user)
      if (analysis.needsUpdate.length > 0) {
        console.log(`[IncrementalUpdate] Queueing ${analysis.needsUpdate.length} description update jobs (Priority 2)`);
        
        for (const matchId of analysis.needsUpdate) {
          try {
            const match = await storage.getSynergyMatchById(matchId);
            if (!match) continue;

            const job = await backgroundJobQueue.queueJob(
              userId,
              'MATCH_DESCRIPTION',
              {
                userId,
                targetUserId: match.matchedUserId,
                userProfileVersion: newProfile.profileVersion,
                updateType: 'update_description'
              },
              2 // Priority 2: Updated descriptions for viewing user
            );
            
            queuedJobs.push(job.id);
            if (firstJobId === null) firstJobId = job.id;
            
            console.log(`[IncrementalUpdate] Queued description update job ${job.id} for match ${matchId}`);
          } catch (error) {
            console.error(`[IncrementalUpdate] Error queueing update for match ${matchId}:`, error);
          }
        }
      }

      // Queue high-priority jobs for new matches (viewing user)
      // These would be discovered by the full match generation process
      const newMatchJob = await backgroundJobQueue.queueJob(
        userId,
        'MATCH_DESCRIPTION',
        {
          userId,
          profileUpdated: true,
          userProfileVersion: newProfile.profileVersion,
          updateType: 'new_match'
        },
        1 // Priority 1: New matches for viewing user
      );
      
      queuedJobs.push(newMatchJob.id);
      if (firstJobId === null) firstJobId = newMatchJob.id;
      
      console.log(`[IncrementalUpdate] Queued new match discovery job ${newMatchJob.id} (Priority 1)`);

      // Step 5: Handle reciprocal updates for affected users
      const affectedUserIds = await storage.findUsersMatchingWithUser(userId);
      console.log(`[IncrementalUpdate] Found ${affectedUserIds.length} users affected by profile changes`);

      if (affectedUserIds.length > 0) {
        // Queue low-priority reciprocal jobs for affected users
        for (const affectedUserId of affectedUserIds) {
          try {
            // Queue reciprocal update job (Priority 9)
            const reciprocalJob = await backgroundJobQueue.queueJob(
              affectedUserId,
              'MATCH_DESCRIPTION',
              {
                userId: affectedUserId,
                targetUserId: userId,
                userProfileVersion: newProfile.profileVersion,
                updateType: 'reciprocal_update'
              },
              9 // Priority 9: Updated descriptions for matched users
            );
            
            console.log(`[IncrementalUpdate] Queued reciprocal update job ${reciprocalJob.id} for affected user ${affectedUserId} (Priority 9)`);
          } catch (error) {
            console.error(`[IncrementalUpdate] Error queueing reciprocal update for user ${affectedUserId}:`, error);
          }
        }
      }

      console.log(`[IncrementalUpdate] Incremental update complete:`, {
        staleMatchesDeleted: analysis.staleMatches.length,
        validMatchesPreserved: analysis.validMatches.length,
        updateJobsQueued: analysis.needsUpdate.length,
        totalJobsQueued: queuedJobs.length,
        affectedUsers: affectedUserIds.length
      });

      return { queuedJobId: firstJobId };

    } catch (error) {
      console.error(`[IncrementalUpdate] Error in incremental profile update:`, error);
      
      // Fall back to full regeneration on error
      console.log(`[IncrementalUpdate] Falling back to full regeneration due to error`);
      
      try {
        await storage.clearSynergyMatchesForUser(userId);
        const fallbackJob = await backgroundJobQueue.queueJob(
          userId,
          'MATCH_DESCRIPTION',
          {
            userId,
            profileUpdated: true,
            userProfileVersion: newProfile.profileVersion,
            updateType: 'fallback_full'
          },
          1
        );
        
        return { queuedJobId: fallbackJob.id };
      } catch (fallbackError) {
        console.error(`[IncrementalUpdate] Fallback also failed:`, fallbackError);
        return { queuedJobId: null };
      }
    }
  }
}

export const centralizedMatchDescriptionCommandCenter = new CentralizedMatchDescriptionCommandCenter();