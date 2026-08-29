import { db } from '../db';
import { locationCoordinates, users } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { geocodingService } from './geocoding';

export interface CachedLocation {
  locationName: string;
  latitude: string;
  longitude: string;
}

export interface LocationUpdateResult {
  success: boolean;
  coordinates?: { lat: string; lng: string };
  fromCache: boolean;
  error?: string;
}

export class LocationCacheService {
  /**
   * Get coordinates for a location, using cache first, then geocoding API
   */
  async getLocationCoordinates(locationName: string): Promise<LocationUpdateResult> {
    if (!locationName?.trim()) {
      return { success: false, fromCache: false, error: 'Location name is required' };
    }

    const normalizedLocation = locationName.trim().toLowerCase();

    try {
      console.log(`[LocationCache] Looking up coordinates for: ${locationName}`);

      // First, check cache
      const cachedLocation = await db
        .select()
        .from(locationCoordinates)
        .where(eq(locationCoordinates.locationName, normalizedLocation))
        .limit(1);

      if (cachedLocation.length > 0) {
        const location = cachedLocation[0];
        console.log(`[LocationCache] Found cached coordinates for ${locationName}: (${location.latitude}, ${location.longitude})`);
        
        // Update last used timestamp
        await this.updateLastUsed(normalizedLocation);
        
        return {
          success: true,
          coordinates: { lat: location.latitude, lng: location.longitude },
          fromCache: true
        };
      }

      // Not in cache, use geocoding API
      console.log(`[LocationCache] Location not cached, using geocoding API for: ${locationName}`);
      const geocodeResult = await geocodingService.geocodeLocation(locationName);

      if (geocodeResult) {
        // Cache the result for future use
        await this.cacheLocation(normalizedLocation, geocodeResult.lat.toString(), geocodeResult.lng.toString());
        
        return {
          success: true,
          coordinates: { lat: geocodeResult.lat.toString(), lng: geocodeResult.lng.toString() },
          fromCache: false
        };
      }

      return {
        success: false,
        fromCache: false,
        error: 'Failed to geocode location'
      };

    } catch (error) {
      console.error(`[LocationCache] Error getting coordinates for ${locationName}:`, error);
      return {
        success: false,
        fromCache: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Cache location coordinates in the database
   */
  private async cacheLocation(locationName: string, latitude: string, longitude: string): Promise<void> {
    try {
      const now = new Date().toISOString();
      
      await db
        .insert(locationCoordinates)
        .values({
          locationName: locationName.toLowerCase(),
          latitude,
          longitude,
          createdAt: now,
          lastUsed: now
        })
        .onConflictDoUpdate({
          target: locationCoordinates.locationName,
          set: {
            latitude,
            longitude,
            lastUsed: now
          }
        });

      console.log(`[LocationCache] Cached coordinates for ${locationName}: (${latitude}, ${longitude})`);
    } catch (error) {
      console.error(`[LocationCache] Error caching location ${locationName}:`, error);
    }
  }

  /**
   * Update the last used timestamp for a cached location
   */
  private async updateLastUsed(locationName: string): Promise<void> {
    try {
      await db
        .update(locationCoordinates)
        .set({ lastUsed: new Date().toISOString() })
        .where(eq(locationCoordinates.locationName, locationName));
    } catch (error) {
      console.error(`[LocationCache] Error updating last used for ${locationName}:`, error);
    }
  }

  /**
   * Update user's current location with coordinates
   */
  async updateUserCurrentLocation(userId: number, locationName: string): Promise<LocationUpdateResult> {
    if (!locationName?.trim()) {
      try {
        // Clear current location
        await db
          .update(users)
          .set({
            currentLocation: null,
            currentLocationLat: null,
            currentLocationLng: null
          })
          .where(eq(users.id, userId));

        console.log(`[LocationCache] Cleared current location for user ${userId}`);
        return { success: true, fromCache: false };
      } catch (error) {
        console.error(`[LocationCache] Error clearing current location for user ${userId}:`, error);
        return { success: false, fromCache: false, error: 'Failed to clear location' };
      }
    }

    const coordinatesResult = await this.getLocationCoordinates(locationName);
    
    if (!coordinatesResult.success) {
      return coordinatesResult;
    }

    try {
      await db
        .update(users)
        .set({
          currentLocation: locationName.trim(),
          currentLocationLat: coordinatesResult.coordinates!.lat,
          currentLocationLng: coordinatesResult.coordinates!.lng
        })
        .where(eq(users.id, userId));

      console.log(`[LocationCache] Updated current location for user ${userId}: ${locationName} (${coordinatesResult.coordinates!.lat}, ${coordinatesResult.coordinates!.lng})`);
      return coordinatesResult;
    } catch (error) {
      console.error(`[LocationCache] Error updating current location for user ${userId}:`, error);
      return { success: false, fromCache: coordinatesResult.fromCache, error: 'Failed to update user location' };
    }
  }

  /**
   * Update user's desired locations with coordinates
   */
  async updateUserDesiredLocations(userId: number, desiredLocations: string[]): Promise<{
    success: boolean;
    results: Array<{ location: string; success: boolean; fromCache: boolean; error?: string }>;
  }> {
    const results: Array<{ location: string; success: boolean; fromCache: boolean; error?: string }> = [];
    const validLocationCoords: string[] = [];
    const validLocations: string[] = [];

    // Process each desired location
    for (const location of desiredLocations) {
      if (!location?.trim()) {
        results.push({ location, success: false, fromCache: false, error: 'Empty location' });
        continue;
      }

      const coordinatesResult = await this.getLocationCoordinates(location);
      
      if (coordinatesResult.success && coordinatesResult.coordinates) {
        const coordData = {
          location: location.trim(),
          lat: coordinatesResult.coordinates.lat,
          lng: coordinatesResult.coordinates.lng
        };
        
        validLocationCoords.push(JSON.stringify(coordData));
        validLocations.push(location.trim());
        results.push({ 
          location: location.trim(), 
          success: true, 
          fromCache: coordinatesResult.fromCache 
        });
      } else {
        results.push({ 
          location: location.trim(), 
          success: false, 
          fromCache: coordinatesResult.fromCache,
          error: coordinatesResult.error 
        });
      }
    }

    try {
      // Update user's desired locations and coordinates
      await db
        .update(users)
        .set({
          desiredLocations: validLocations,
          desiredLocationCoords: validLocationCoords
        })
        .where(eq(users.id, userId));

      console.log(`[LocationCache] Updated desired locations for user ${userId}: ${validLocations.length} valid locations`);
      
      return {
        success: true,
        results
      };
    } catch (error) {
      console.error(`[LocationCache] Error updating desired locations for user ${userId}:`, error);
      return {
        success: false,
        results
      };
    }
  }

  /**
   * Get cached statistics for cost analysis
   */
  async getCacheStatistics(): Promise<{
    totalCachedLocations: number;
    cacheHitRate: number;
    oldestEntry: string | null;
    newestEntry: string | null;
  }> {
    try {
      const stats = await db
        .select({
          count: sql<number>`COUNT(*)`,
          oldestCreated: sql<string>`MIN(created_at)`,
          newestCreated: sql<string>`MAX(created_at)`
        })
        .from(locationCoordinates);

      const totalCachedLocations = stats[0]?.count || 0;
      
      // For now, we'll estimate cache hit rate at 80% for cached locations
      // In a real implementation, you'd track cache hits vs misses
      const cacheHitRate = totalCachedLocations > 0 ? 0.8 : 0;

      return {
        totalCachedLocations,
        cacheHitRate,
        oldestEntry: stats[0]?.oldestCreated || null,
        newestEntry: stats[0]?.newestCreated || null
      };
    } catch (error) {
      console.error('[LocationCache] Error getting cache statistics:', error);
      return {
        totalCachedLocations: 0,
        cacheHitRate: 0,
        oldestEntry: null,
        newestEntry: null
      };
    }
  }

  /**
   * Clean up old unused cache entries (for maintenance)
   */
  async cleanupOldEntries(daysOld: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      const deleted = await db
        .delete(locationCoordinates)
        .where(sql`${locationCoordinates.lastUsed} < ${cutoffDate.toISOString()}`)
        .returning({ id: locationCoordinates.id });

      console.log(`[LocationCache] Cleaned up ${deleted.length} old cache entries`);
      return deleted.length;
    } catch (error) {
      console.error('[LocationCache] Error cleaning up old entries:', error);
      return 0;
    }
  }
}

export const locationCacheService = new LocationCacheService();