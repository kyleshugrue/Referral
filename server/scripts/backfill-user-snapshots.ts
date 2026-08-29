import { db } from '../db';
import { users } from '../../shared/schema';
import { snapshotService } from '../services/profile-snapshot-service';
import { extractProfileData } from '../services/background-job-queue';
import { eq, isNull } from 'drizzle-orm';

/**
 * Backfill Script: Create Profile Snapshots for Existing Users
 * 
 * This script generates immutable profile snapshots for all users who don't have one yet.
 * It should be run once during the migration to the snapshot system.
 * 
 * Usage: npx tsx server/scripts/backfill-user-snapshots.ts
 */

async function backfillUserSnapshots() {
  console.log('[Backfill] Starting user snapshot backfill...');
  
  try {
    // Find all users without a currentSnapshotId
    const usersWithoutSnapshots = await db
      .select()
      .from(users)
      .where(isNull(users.currentSnapshotId));
    
    console.log(`[Backfill] Found ${usersWithoutSnapshots.length} users without snapshots`);
    
    if (usersWithoutSnapshots.length === 0) {
      console.log('[Backfill] All users already have snapshots. Nothing to do.');
      return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ userId: number; error: string }> = [];
    
    // Process each user
    for (const user of usersWithoutSnapshots) {
      try {
        console.log(`[Backfill] Creating snapshot for user ${user.id}...`);
        
        // Extract profile data
        const profileData = extractProfileData(user);
        
        // Create snapshot
        const snapshot = await snapshotService.createSnapshot(user.id, profileData);
        
        // Update user's currentSnapshotId
        await db
          .update(users)
          .set({ currentSnapshotId: snapshot.id })
          .where(eq(users.id, user.id));
        
        console.log(`[Backfill] ✓ Created snapshot ${snapshot.id} for user ${user.id}`);
        successCount++;
        
      } catch (error) {
        console.error(`[Backfill] ✗ Failed to create snapshot for user ${user.id}:`, error);
        errorCount++;
        errors.push({
          userId: user.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    // Summary
    console.log('\n[Backfill] Backfill complete!');
    console.log(`[Backfill] Successfully created: ${successCount} snapshots`);
    console.log(`[Backfill] Failed: ${errorCount} snapshots`);
    
    if (errors.length > 0) {
      console.log('\n[Backfill] Errors:');
      errors.forEach(({ userId, error }) => {
        console.log(`  - User ${userId}: ${error}`);
      });
    }
    
  } catch (error) {
    console.error('[Backfill] Fatal error during backfill:', error);
    throw error;
  }
}

// Run the backfill
backfillUserSnapshots()
  .then(() => {
    console.log('[Backfill] Script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Backfill] Script failed:', error);
    process.exit(1);
  });
