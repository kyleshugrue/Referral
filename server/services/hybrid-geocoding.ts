/**
 * Hybrid Geocoding Service for backend AI matching
 * Supports both Apple MapKit coordinates (from iOS clients) and Google Maps geocoding
 * Provides seamless coordinate handling for location-based matching
 */

import { zipCodeGeocoder } from './zip-code-geocoder';
import { geocodingService } from './geocoding';

// Platform detection types
type PlatformType = 'ios-native' | 'web';

interface Coordinates {
  lat: number;
  lng: number;
}

interface GeocodeResult {
  location: string;
  coordinates: Coordinates;
}

interface ClientLocationData {
  location: string;
  coordinates?: Coordinates;
  source?: 'apple_mapkit' | 'google_maps' | 'user_input';
}

class HybridGeocodingService {
  private cache = new Map<string, Coordinates>();
  private readonly maxCacheEntries = 1000;

  /**
   * Extract platform information from request headers
   */
  private getPlatformFromHeaders(headers: Record<string, string | string[] | undefined>): PlatformType {
    const platformHeader = headers['x-platform'] || headers['X-Platform'];
    const platform = Array.isArray(platformHeader) ? platformHeader[0] : platformHeader;
    
    return platform === 'ios-native' ? 'ios-native' : 'web';
  }

  /**
   * Platform-aware geocoding that avoids Google API costs for iOS native
   * iOS native clients should provide coordinates from Apple MapKit client-side
   */
  async geocodeLocationWithPlatform(
    location: string, 
    headers: Record<string, string | string[] | undefined>
  ): Promise<Coordinates | null> {
    const platform = this.getPlatformFromHeaders(headers);
    
    if (platform === 'ios-native') {
      // For iOS native, we expect coordinates to be provided client-side via Apple MapKit
      // Only use fallback methods, never Google API
      return await this.geocodeLocationIOSNative(location);
    } else {
      // For web platforms, use full geocoding pipeline including Google API
      return await this.geocodeLocation(location);
    }
  }

  /**
   * iOS native geocoding - uses only free methods, never Google API
   */
  private async geocodeLocationIOSNative(location: string): Promise<Coordinates | null> {
    if (!location?.trim()) return null;

    const normalizedLocation = location.trim().toLowerCase();
    
    // Check cache first
    if (this.cache.has(normalizedLocation)) {
      return this.cache.get(normalizedLocation)!;
    }

    // Try ZIP code approximation (free)
    try {
      const zipCoordinates = await zipCodeGeocoder.geocodeByZip(location);
      if (zipCoordinates) {
        this.setCached(normalizedLocation, zipCoordinates);
        return zipCoordinates;
      }
    } catch (error) {
      console.warn('[HybridGeocodingService] iOS ZIP approximation failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    // Fall back to hardcoded coordinates only (never Google API)
    return this.getFallbackCoordinates(location);
  }

  /**
   * Process location data from hybrid clients with platform awareness
   * Handles coordinates from Apple MapKit (iOS) or needs to geocode for web clients
   */
  async processClientLocation(
    locationData: ClientLocationData, 
    headers?: Record<string, string | string[] | undefined>
  ): Promise<Coordinates | null> {
    // If coordinates are already provided (from iOS Apple MapKit), use them
    if (locationData.coordinates) {
      // Cache the coordinates for future use
      const normalizedLocation = locationData.location.trim().toLowerCase();
      this.setCached(normalizedLocation, locationData.coordinates);
      
      return locationData.coordinates;
    }

    if (!locationData.location?.trim() || locationData.location.length > 200) return null;

    // Otherwise, geocode the location string using platform-aware service
    if (headers) {
      return await this.geocodeLocationWithPlatform(locationData.location, headers);
    } else {
      // Fallback to original method if no headers provided
      return await this.geocodeLocation(locationData.location);
    }
  }

  /**
   * Convert a city name to coordinates using optimal geocoding strategy
   * 1. Check local cache first
   * 2. Try ZIP code approximation (90% cost savings)
   * 3. Fall back to Google Geocoding API if needed
   */
  async geocodeLocation(location: string): Promise<Coordinates | null> {
    return geocodingService.geocodeLocation(location);
  }

  /**
   * PERFORMANCE OPTIMIZED: Batch process multiple locations efficiently with intelligent caching (platform-aware)
   * This significantly improves AI matching performance by processing locations in parallel
   * with shared cache lookup and reduced API calls. Respects platform routing to avoid Google API for iOS native.
   */
  async batchGeocodeLocations(
    locations: string[], 
    headers?: Record<string, string | string[] | undefined>
  ): Promise<Map<string, Coordinates | null>> {
    const results = new Map<string, Coordinates | null>();
    const uniqueLocations = [...new Set(locations.filter(loc => loc?.trim()))];
    
    // OPTIMIZATION: Separate cached vs. non-cached locations to minimize API calls
    const cachedLocations: string[] = [];
    const uncachedLocations: string[] = [];
    
    // Pre-check cache for all locations
    for (const location of uniqueLocations) {
      const normalizedLocation = location.trim().toLowerCase();
      if (this.cache.has(normalizedLocation)) {
        cachedLocations.push(location);
        results.set(location, this.cache.get(normalizedLocation)!);
      } else {
        uncachedLocations.push(location);
      }
    }
    
    // Process only uncached locations in bounded chunks using platform-aware
    // methods; the shared geocoder also deduplicates concurrent misses.
    if (uncachedLocations.length > 0) {
      for (let index = 0; index < uncachedLocations.length; index += 4) {
        const chunk = uncachedLocations.slice(index, index + 4);
        await Promise.all(chunk.map(async (location) => {
          const coordinates = headers
            ? await this.geocodeLocationWithPlatform(location, headers)
            : await this.geocodeLocation(location);
          results.set(location, coordinates);
        }));
      }
    }
    
    return results;
  }

  /**
   * Calculate the distance between two coordinates using the Haversine formula
   * Returns distance in miles
   */
  calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRadians(coord2.lat - coord1.lat);
    const dLng = this.toRadians(coord2.lng - coord1.lng);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(coord1.lat)) * Math.cos(this.toRadians(coord2.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return Math.round(distance * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Check if two locations are within the specified radius (platform-aware)
   * Enhanced to handle hybrid coordinate sources and avoid Google API for iOS native
   */
  async isWithinRadius(
    location1: string | ClientLocationData, 
    location2: string | ClientLocationData, 
    radiusMiles: number,
    headers?: Record<string, string | string[] | undefined>
  ): Promise<boolean> {
    if (radiusMiles < 0) return false;
    
    // Process locations to get coordinates using platform-aware methods
    const coord1 = typeof location1 === 'string' 
      ? (headers ? await this.geocodeLocationWithPlatform(location1, headers) : await this.geocodeLocation(location1))
      : await this.processClientLocation(location1, headers);
      
    const coord2 = typeof location2 === 'string' 
      ? (headers ? await this.geocodeLocationWithPlatform(location2, headers) : await this.geocodeLocation(location2))
      : await this.processClientLocation(location2, headers);
    
    if (!coord1 || !coord2) {
      console.warn('[HybridGeocodingService] Could not geocode one or more locations');
      
      // Fall back to exact string matching if geocoding fails
      const loc1Str = typeof location1 === 'string' ? location1 : location1.location;
      const loc2Str = typeof location2 === 'string' ? location2 : location2.location;
      return loc1Str.toLowerCase().trim() === loc2Str.toLowerCase().trim();
    }
    
    const distance = this.calculateDistance(coord1, coord2);
    const withinRadius = distance <= radiusMiles;
    
    return withinRadius;
  }

  /**
   * Batch distance calculations for AI matching optimization (platform-aware)
   */
  async batchDistanceCalculations(
    referenceLocation: string | ClientLocationData,
    targetLocations: (string | ClientLocationData)[],
    headers?: Record<string, string | string[] | undefined>
  ): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();
    
    // Get reference coordinates using platform-aware method
    const refCoord = typeof referenceLocation === 'string' 
      ? (headers ? await this.geocodeLocationWithPlatform(referenceLocation, headers) : await this.geocodeLocation(referenceLocation))
      : await this.processClientLocation(referenceLocation, headers);
    
    if (!refCoord) {
      console.warn('[HybridGeocodingService] Could not geocode reference location');
      return results;
    }
    
    // Calculate distances to all targets using platform-aware methods
    for (const targetLocation of targetLocations) {
      const targetCoord = typeof targetLocation === 'string' 
        ? (headers ? await this.geocodeLocationWithPlatform(targetLocation, headers) : await this.geocodeLocation(targetLocation))
        : await this.processClientLocation(targetLocation, headers);
      
      const locationKey = typeof targetLocation === 'string' ? targetLocation : targetLocation.location;
      
      if (targetCoord) {
        const distance = this.calculateDistance(refCoord, targetCoord);
        results.set(locationKey, distance);
      } else {
        results.set(locationKey, null);
      }
    }
    
    return results;
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Provide fallback coordinates for major US cities when geocoding fails
   */
  private getFallbackCoordinates(location: string): Coordinates | null {
    const fallbacks: Record<string, Coordinates> = {
      'new york': { lat: 40.7128, lng: -74.0060 },
      'los angeles': { lat: 34.0522, lng: -118.2437 },
      'chicago': { lat: 41.8781, lng: -87.6298 },
      'houston': { lat: 29.7604, lng: -95.3698 },
      'phoenix': { lat: 33.4484, lng: -112.0740 },
      'philadelphia': { lat: 39.9526, lng: -75.1652 },
      'san antonio': { lat: 29.4241, lng: -98.4936 },
      'san diego': { lat: 32.7157, lng: -117.1611 },
      'dallas': { lat: 32.7767, lng: -96.7970 },
      'san jose': { lat: 37.3382, lng: -121.8863 },
      'austin': { lat: 30.2672, lng: -97.7431 },
      'jacksonville': { lat: 30.3322, lng: -81.6557 },
      'san francisco': { lat: 37.7749, lng: -122.4194 },
      'columbus': { lat: 39.9612, lng: -82.9988 },
      'fort worth': { lat: 32.7555, lng: -97.3308 },
      'charlotte': { lat: 35.2271, lng: -80.8431 },
      'seattle': { lat: 47.6062, lng: -122.3321 },
      'denver': { lat: 39.7392, lng: -104.9903 },
      'washington': { lat: 38.9072, lng: -77.0369 },
      'boston': { lat: 42.3601, lng: -71.0589 },
      'el paso': { lat: 31.7619, lng: -106.4850 },
      'detroit': { lat: 42.3314, lng: -83.0458 },
      'nashville': { lat: 36.1627, lng: -86.7816 },
      'memphis': { lat: 35.1495, lng: -90.0490 },
      'portland': { lat: 45.5152, lng: -122.6784 },
      'oklahoma city': { lat: 35.4676, lng: -97.5164 },
      'las vegas': { lat: 36.1699, lng: -115.1398 },
      'louisville': { lat: 38.2527, lng: -85.7585 },
      'baltimore': { lat: 39.2904, lng: -76.6122 },
      'milwaukee': { lat: 43.0389, lng: -87.9065 },
      'albuquerque': { lat: 35.0844, lng: -106.6504 },
      'tucson': { lat: 32.2226, lng: -110.9747 },
      'fresno': { lat: 36.7378, lng: -119.7871 },
      'sacramento': { lat: 38.5816, lng: -121.4944 },
      'mesa': { lat: 33.4152, lng: -111.8315 },
      'kansas city': { lat: 39.0997, lng: -94.5786 },
      'atlanta': { lat: 33.7490, lng: -84.3880 },
      'omaha': { lat: 41.2565, lng: -95.9345 },
      'colorado springs': { lat: 38.8339, lng: -104.8214 },
      'raleigh': { lat: 35.7796, lng: -78.6382 },
      'miami': { lat: 25.7617, lng: -80.1918 },
      'virginia beach': { lat: 36.8529, lng: -75.9780 },
      'long beach': { lat: 33.7701, lng: -118.1937 },
      'minneapolis': { lat: 44.9778, lng: -93.2650 },
      'tampa': { lat: 27.9506, lng: -82.4572 },
      'oakland': { lat: 37.8044, lng: -122.2711 },
      'tulsa': { lat: 36.1539, lng: -95.9928 },
      'arlington': { lat: 32.7357, lng: -97.1081 },
      'new orleans': { lat: 29.9511, lng: -90.0715 }
    };

    const normalizedLocation = location.toLowerCase().trim();
    const fallback = fallbacks[normalizedLocation];
    
    if (fallback) {
      // Cache the fallback result
          this.setCached(normalizedLocation, fallback);
      return fallback;
    }
    
    console.warn('[HybridGeocodingService] No fallback coordinates available');
    return null;
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    return {
      cacheSize: this.cache.size,
      cachedLocations: Array.from(this.cache.keys())
    };
  }

  /**
   * Clear cache (useful for testing or memory management)
   */
  clearCache() {
    this.cache.clear();
    console.log('[HybridGeocodingService] Cache cleared');
  }

  private setCached(key: string, value: Coordinates): void {
    if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }
}

// Export singleton instance
export const hybridGeocodingService = new HybridGeocodingService();
export default hybridGeocodingService;

// Export types for use in other services
export type { ClientLocationData, Coordinates, GeocodeResult };