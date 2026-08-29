import { db } from '../db';
import { users, matchGenerationJobs } from '../../shared/schema';
import { snapshotService } from '../services/profile-snapshot-service';
import { extractProfileData } from '../services/background-job-queue';
import { eq, and, or, isNull } from 'drizzle-orm';

/**
 * Update Pending Jobs Script: Add Snapshot IDs to Legacy Jobs
 * 
 * This script finds all pending match generation jobs that are missing snapshot IDs
 * and backfills them with the appropriate snapshot references. This allows legacy jobs
 * created before the snapshot system to be processed by the new snapshot-aware worker.
 * 
 * The script will:
 * 1. Find all PENDING jobs without userSnapshotId or targetUserSnapshotId
 * 2. For each job, get or create snapshots for both users
 * 3. Update the job with the snapshot IDs
 * 
 * Usage: npx tsx server/scripts/update-pending-jobs.ts
 */

async function updatePendingJobs() {
  console.log('[UpdateJobs] Starting pending job update...');
  
  try {
    // Find all pending jobs without snapshot IDs
    const pendingJobs = await db
      .select()
      .from(matchGenerationJobs)
      .where(
        and(
          eq(matchGenerationJobs.status, 'PENDING'),
          or(
            isNull(matchGenerationJobs.userSnapshotId),
            isNull(matchGenerationJobs.targetUserSnapshotId)
          )
        )
      );
    
    console.log(`[UpdateJobs] Found ${pendingJobs.length} pending jobs without snapshot IDs`);
    
    if (pendingJobs.length === 0) {
      console.log('[UpdateJobs] All pending jobs already have snapshot IDs. Nothing to do.');
      return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ jobId: number; error: string }> = [];
    
    // Process each job
    for (const job of pendingJobs) {
      try {
        // Parse metadata if it's a string
        const metadata = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata;
        const targetUserId = metadata?.targetUserId;
        
        console.log(`[UpdateJobs] Processing job ${job.id} (user: ${job.userId}, target: ${targetUserId || 'none'})...`);
        
        // Get user
        const user = await db.query.users.findFirst({
          where: eq(users.id, job.userId)
        });
        
        if (!user) {
          throw new Error(`User ${job.userId} not found`);
        }
        
        // Get or create user snapshot
        let userSnapshot;
        if (user.currentSnapshotId) {
          userSnapshot = await snapshotService.getSnapshot(user.currentSnapshotId, user.id);
        }
        
        if (!userSnapshot) {
          const profileData = extractProfileData(user);
          userSnapshot = await snapshotService.createSnapshot(user.id, profileData);
          
          // Update user's currentSnapshotId
          await db
            .update(users)
            .set({ currentSnapshotId: userSnapshot.id })
            .where(eq(users.id, user.id));
          
          console.log(`[UpdateJobs] Created new snapshot ${userSnapshot.id} for user ${user.id}`);
        } else {
          console.log(`[UpdateJobs] Using existing snapshot ${userSnapshot.id} for user ${user.id}`);
        }
        
        // Get target user snapshot if targetUserId exists
        let targetUserSnapshotId = null;
        
        if (targetUserId) {
          const targetUser = await db.query.users.findFirst({
            where: eq(users.id, targetUserId)
          });
          
          if (targetUser) {
            let targetSnapshot;
            if (targetUser.currentSnapshotId) {
              targetSnapshot = await snapshotService.getSnapshot(targetUser.currentSnapshotId, targetUser.id);
            }
            
            if (!targetSnapshot) {
              const targetProfileData = extractProfileData(targetUser);
              targetSnapshot = await snapshotService.createSnapshot(targetUser.id, targetProfileData);
              
              // Update target user's currentSnapshotId
              await db
                .update(users)
                .set({ currentSnapshotId: targetSnapshot.id })
                .where(eq(users.id, targetUser.id));
              
              console.log(`[UpdateJobs] Created new snapshot ${targetSnapshot.id} for target user ${targetUser.id}`);
            } else {
              console.log(`[UpdateJobs] Using existing snapshot ${targetSnapshot.id} for target user ${targetUser.id}`);
            }
            
            targetUserSnapshotId = targetSnapshot.id;
          } else {
            console.warn(`[UpdateJobs] Target user ${targetUserId} not found for job ${job.id}`);
          }
        }
        
        // Update job with snapshot IDs
        await db
          .update(matchGenerationJobs)
          .set({
            userSnapshotId: userSnapshot.id,
            targetUserSnapshotId: targetUserSnapshotId
          })
          .where(eq(matchGenerationJobs.id, job.id));
        
        console.log(`[UpdateJobs] ✓ Updated job ${job.id} with snapshot IDs (user: ${userSnapshot.id}, target: ${targetUserSnapshotId || 'none'})`);
        successCount++;
        
      } catch (error) {
        console.error(`[UpdateJobs] ✗ Failed to update job ${job.id}:`, error);
        errorCount++;
        errors.push({
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    // Summary
    console.log('\n[UpdateJobs] Update complete!');
    console.log(`[UpdateJobs] Successfully updated: ${successCount} jobs`);
    console.log(`[UpdateJobs] Failed: ${errorCount} jobs`);
    
    if (errors.length > 0) {
      console.log('\n[UpdateJobs] Errors:');
      errors.forEach(({ jobId, error }) => {
        console.log(`  - Job ${jobId}: ${error}`);
      });
    }
    
    // Show updated job statistics
    const stats = await db
      .select()
      .from(matchGenerationJobs)
      .where(eq(matchGenerationJobs.status, 'PENDING'));
    
    const withSnapshots = stats.filter(j => j.userSnapshotId !== null).length;
    const withoutSnapshots = stats.filter(j => j.userSnapshotId === null).length;
    
    console.log('\n[UpdateJobs] Current pending job statistics:');
    console.log(`  - Total pending: ${stats.length}`);
    console.log(`  - With snapshots: ${withSnapshots}`);
    console.log(`  - Without snapshots: ${withoutSnapshots}`);
    
  } catch (error) {
    console.error('[UpdateJobs] Fatal error during job update:', error);
    throw error;
  }
}

// Run the update
updatePendingJobs()
  .then(() => {
    console.log('[UpdateJobs] Script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[UpdateJobs] Script failed:', error);
    process.exit(1);
  });
