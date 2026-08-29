import { db } from '../db';
import { userProfileSnapshots } from '@shared/schema';
import type { UserProfileSnapshot } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import crypto from 'crypto';
import stringify from 'json-stable-stringify';

export interface ProfileData {
  bio: string | null;
  title: string | null;
  currentLocation: string | null;
  currentLocationLat: string | null;
  currentLocationLng: string | null;
  industry: string | null;
  currentCompany: string | null;
  desiredLocations: string[] | null;
  desiredCompanies: string[] | null;
  interests: string[] | null;
  professionalInterests: string[] | null;
  languages: string[] | null;
  matchingRadius: number;
  yearsOfExperience: number;
  educationLevel: string | null;
  institution: string | null;
  [key: string]: unknown;
}

export class ProfileSnapshotService {
  async createSnapshot(userId: number, profileData: ProfileData): Promise<{ id: number; contentHash: string }> {
    const contentHash = this.generateContentHash(profileData);
    
    try {
      const existing = await db
        .select({ id: userProfileSnapshots.id, contentHash: userProfileSnapshots.contentHash })
        .from(userProfileSnapshots)
        .where(
          and(
            eq(userProfileSnapshots.userId, userId),
            eq(userProfileSnapshots.contentHash, contentHash)
          )
        )
        .limit(1);
      
      if (existing.length > 0) {
        console.log(`[ProfileSnapshotService] Reusing existing snapshot ${existing[0].id} for user ${userId}`);
        return existing[0];
      }
      
      const [snapshot] = await db
        .insert(userProfileSnapshots)
        .values({
          userId,
          contentHash,
          profileData: JSON.stringify(profileData)
        })
        .returning({ id: userProfileSnapshots.id, contentHash: userProfileSnapshots.contentHash });
      
      console.log(`[ProfileSnapshotService] Created snapshot ${snapshot.id} for user ${userId} (hash: ${contentHash.substring(0, 12)}...)`);
      
      return snapshot;
    } catch (error: unknown) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (errorCode === '23505') {
        const [existing] = await db
          .select({ id: userProfileSnapshots.id, contentHash: userProfileSnapshots.contentHash })
          .from(userProfileSnapshots)
          .where(
            and(
              eq(userProfileSnapshots.userId, userId),
              eq(userProfileSnapshots.contentHash, contentHash)
            )
          )
          .limit(1);
        
        return existing;
      }
      throw error;
    }
  }
  
  async getSnapshot(snapshotId: number, expectedUserId?: number): Promise<UserProfileSnapshot | null> {
    const results = await db
      .select()
      .from(userProfileSnapshots)
      .where(eq(userProfileSnapshots.id, snapshotId))
      .limit(1);
    
    if (results.length === 0) {
      return null;
    }
    
    const snapshot = results[0];
    
    if (expectedUserId !== undefined && snapshot.userId !== expectedUserId) {
      throw new Error(`Snapshot ${snapshotId} does not belong to user ${expectedUserId}`);
    }
    
    return snapshot;
  }
  
  async getLatestSnapshot(userId: number): Promise<UserProfileSnapshot | null> {
    const results = await db
      .select()
      .from(userProfileSnapshots)
      .where(eq(userProfileSnapshots.userId, userId))
      .orderBy(desc(userProfileSnapshots.createdAt))
      .limit(1);
    
    return results.length > 0 ? results[0] : null;
  }
  
  private generateContentHash(profileData: ProfileData): string {
    const normalized = stringify(profileData);
    if (normalized === undefined) {
      throw new Error('Failed to serialize profile data for content hashing');
    }
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }
  
  parseSnapshotData(snapshot: UserProfileSnapshot): ProfileData {
    if (typeof snapshot.profileData === 'string') {
      return JSON.parse(snapshot.profileData);
    }
    return snapshot.profileData as ProfileData;
  }
}

export const snapshotService = new ProfileSnapshotService();
