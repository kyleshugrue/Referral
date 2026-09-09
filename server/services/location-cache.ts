import { db } from '../db';
import { locationCoordinates, users } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { geocodingService } from './geocoding';
import { logger } from '../lib/logger';

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
      logger.operational('[LocationCache] Looking up coordinates', {
        action: 'lookup',
      });

      // First, check cache
      const cachedLocation = await db
        .select()
        .from(locationCoordinates)
        .where(eq(locationCoordinates.locationName, normalizedLocation))
        .limit(1);

      if (cachedLocation.length > 0) {
        const location = cachedLocation[0];
        logger.operational('[LocationCache] Cache hit', { action: 'lookup', cacheHit: true });
        
        // Update last used timestamp
        await this.updateLastUsed(normalizedLocation);
        
        return {
          success: true,
          coordinates: { lat: location.latitude, lng: location.longitude },
          fromCache: true
        };
      }

      // Not in cache, use geocoding API
      logger.operational('[LocationCache] Cache miss; using geocoding API', {
        action: 'lookup',
        cacheHit: false,
      });
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
      logger.error('[LocationCache] Error getting coordinates', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
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

      logger.operational('[LocationCache] Coordinates cached', { action: 'cache-write' });
    } catch (error) {
      logger.error('[LocationCache] Error caching coordinates', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
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
      logger.error('[LocationCache] Error updating location cache timestamp', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
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

        logger.operational('[LocationCache] Cleared current location', {
          userId,
          hasLocation: false,
        });
        return { success: true, fromCache: false };
      } catch (error) {
        logger.error('[LocationCache] Error clearing current location', {
          errorClass: error instanceof Error ? error.name : 'UnknownError',
          userId,
        });
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

      logger.operational('[LocationCache] Updated current location', {
        userId,
        hasLocation: true,
        hasCoordinates: Boolean(coordinatesResult.coordinates),
      });
      return coordinatesResult;
    } catch (error) {
      logger.error('[LocationCache] Error updating current location', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        userId,
      });
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

      logger.operational('[LocationCache] Updated desired locations', {
        userId,
        validLocationCount: validLocations.length,
      });
      
      return {
        success: true,
        results
      };
    } catch (error) {
      logger.error('[LocationCache] Error updating desired locations', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        userId,
      });
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
      logger.error('[LocationCache] Error getting cache statistics', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
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

      logger.operational('[LocationCache] Cleaned up old cache entries', { count: deleted.length });
      return deleted.length;
    } catch (error) {
      logger.error('[LocationCache] Error cleaning up old entries', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      return 0;
    }
  }
}

export const locationCacheService = new LocationCacheService();