import type { User } from '@shared/schema';
import { locationCacheService } from './location-cache';

interface Coordinates {
  lat: number;
  lng: number;
}

export class OptimizedLocationMatcher {
  /**
   * Calculate distance between two coordinates using Haversine formula
   * Returns distance in miles
   */
  private calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
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

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Check if two locations are within radius using cached coordinates
   */
  async isWithinRadiusOptimized(user1: User, user2: User, user1MatchingRadius: number): Promise<boolean> {
    try {
      // Use cached coordinates if available
      if (user1.currentLocationLat && user1.currentLocationLng && 
          user2.currentLocationLat && user2.currentLocationLng) {
        
        const coord1: Coordinates = {
          lat: parseFloat(user1.currentLocationLat),
          lng: parseFloat(user1.currentLocationLng)
        };
        
        const coord2: Coordinates = {
          lat: parseFloat(user2.currentLocationLat),
          lng: parseFloat(user2.currentLocationLng)
        };

        const distance = this.calculateDistance(coord1, coord2);
        console.log(`[OptimizedLocationMatcher] Using cached coordinates - Distance between ${user1.currentLocation} and ${user2.currentLocation}: ${distance} miles (radius: ${user1MatchingRadius})`);
        
        return distance <= user1MatchingRadius;
      }

      // Fallback: one or both users don't have cached coordinates
      console.log(`[OptimizedLocationMatcher] Cached coordinates missing, skipping location match for users ${user1.id} and ${user2.id}`);
      return false;

    } catch (error) {
      console.error(`[OptimizedLocationMatcher] Error checking radius for users ${user1.id} and ${user2.id}:`, error);
      return false;
    }
  }

  /**
   * Check if a user's current location is within their own desired locations radius
   * Used for metro radius matching - when user is within radius of their own location interests
   */
  async isUserCurrentInOwnDesired(user: User): Promise<boolean> {
    if (!user.desiredLocationCoords?.length || !user.currentLocationLat || !user.currentLocationLng) {
      return false;
    }

    const userCurrentCoord: Coordinates = {
      lat: parseFloat(user.currentLocationLat),
      lng: parseFloat(user.currentLocationLng)
    };

    const userMatchingRadius = user.matchingRadius ?? 0;

    try {
      // Check each of user's desired locations
      for (const coordString of user.desiredLocationCoords) {
        try {
          const coordData = JSON.parse(coordString);
          const desiredCoord: Coordinates = {
            lat: parseFloat(coordData.lat),
            lng: parseFloat(coordData.lng)
          };

          const distance = this.calculateDistance(userCurrentCoord, desiredCoord);
          
          if (distance <= userMatchingRadius) {
            console.log(`[OptimizedLocationMatcher] User ${user.id} at ${user.currentLocation} is within ${userMatchingRadius} miles of their own desired location ${coordData.location} (distance: ${distance} miles)`);
            return true;
          }
        } catch (parseError) {
          console.error(`[OptimizedLocationMatcher] Error parsing coordinate data for user ${user.id}:`, parseError);
          continue;
        }
      }

      console.log(`[OptimizedLocationMatcher] User ${user.id} at ${user.currentLocation} is NOT within radius of any of their desired locations`);
      return false;
    } catch (error) {
      console.error(`[OptimizedLocationMatcher] Error checking user current in own desired:`, error);
      return false;
    }
  }

  /**
   * Check if user2's current location is within user1's desired locations radius
   * Uses cached coordinates for optimal performance
   */
  async isUser2CurrentInUser1Desired(user1: User, user2: User): Promise<boolean> {
    if (!user1.desiredLocationCoords?.length || !user2.currentLocationLat || !user2.currentLocationLng) {
      return false;
    }

    const user2CurrentCoord: Coordinates = {
      lat: parseFloat(user2.currentLocationLat),
      lng: parseFloat(user2.currentLocationLng)
    };

    const user1MatchingRadius = user1.matchingRadius ?? 0;

    try {
      // Check each of user1's desired locations
      for (const coordString of user1.desiredLocationCoords) {
        try {
          const coordData = JSON.parse(coordString);
          const desiredCoord: Coordinates = {
            lat: parseFloat(coordData.lat),
            lng: parseFloat(coordData.lng)
          };

          const distance = this.calculateDistance(user2CurrentCoord, desiredCoord);
          
          if (distance <= user1MatchingRadius) {
            console.log(`[OptimizedLocationMatcher] User ${user2.id} at ${user2.currentLocation} is within ${user1MatchingRadius} miles of user ${user1.id}'s desired location ${coordData.location} (distance: ${distance} miles)`);
            return true;
          }
        } catch (parseError) {
          console.error(`[OptimizedLocationMatcher] Error parsing coordinate data for user ${user1.id}:`, parseError);
          continue;
        }
      }

      return false;
    } catch (error) {
      console.error(`[OptimizedLocationMatcher] Error checking user2 current in user1 desired:`, error);
      return false;
    }
  }

  /**
   * Check if user1 wants to relocate within their radius of user2's current location
   * This is the correct logic: user wants to move within their set radius of other user's current location
   * 
   * Special handling for bidirectional edge case: when both users have mutual relocation interests
   * AND both include their current location in desired locations, filter out current location
   * to prioritize actual relocation swap over staying in place
   */
  async isUser1WantsToRelocateNearUser2Current(user1: User, user2: User): Promise<boolean> {
    if (!user1.desiredLocationCoords?.length || !user2.currentLocationLat || !user2.currentLocationLng) {
      return false;
    }

    const user2CurrentCoord: Coordinates = {
      lat: parseFloat(user2.currentLocationLat),
      lng: parseFloat(user2.currentLocationLng)
    };

    const user1MatchingRadius = user1.matchingRadius ?? 25; // Default 25 miles

    try {
      // Check if this is the bidirectional edge case where we should filter out current locations
      const shouldFilterCurrentLocation = await this.isBidirectionalEdgeCase(user1, user2);
      
      let desiredLocationCoords = user1.desiredLocationCoords;
      
      if (shouldFilterCurrentLocation) {
        // Filter out user1's current location from their desired locations for this specific edge case
        desiredLocationCoords = user1.desiredLocationCoords.filter(coordString => {
          try {
            const coordData = JSON.parse(coordString);
            // Remove if the desired location matches user's current location (case-insensitive)
            return coordData.location.toLowerCase().trim() !== (user1.currentLocation || '').toLowerCase().trim();
          } catch (parseError) {
            console.error(`[OptimizedLocationMatcher] Error parsing coordinate data for filtering:`, parseError);
            return true; // Keep if can't parse
          }
        });
        
        console.log(`[OptimizedLocationMatcher] Bidirectional edge case detected - filtered out current location for user ${user1.id}. Original: ${user1.desiredLocationCoords.length}, Filtered: ${desiredLocationCoords.length}`);
      }

      // Check each of user1's (possibly filtered) desired locations to see if any are within radius of user2's current location
      for (const coordString of desiredLocationCoords) {
        try {
          const coordData = JSON.parse(coordString);
          const user1DesiredCoord: Coordinates = {
            lat: parseFloat(coordData.lat),
            lng: parseFloat(coordData.lng)
          };

          const distance = this.calculateDistance(user1DesiredCoord, user2CurrentCoord);
          
          if (distance <= user1MatchingRadius) {
            console.log(`[OptimizedLocationMatcher] User ${user1.id} wants to relocate to ${coordData.location} which is within ${user1MatchingRadius} miles of user ${user2.id}'s current location ${user2.currentLocation} (distance: ${distance} miles)`);
            return true;
          }
        } catch (parseError) {
          console.error(`[OptimizedLocationMatcher] Error parsing coordinate data for user ${user1.id}:`, parseError);
          continue;
        }
      }

      return false;
    } catch (error) {
      console.error(`[OptimizedLocationMatcher] Error checking user1 wants to relocate near user2 current:`, error);
      return false;
    }
  }

  /**
   * Metro radius matching: Check if users are within radius of their SPECIFIC OVERLAPPING location interest
   * Only checks locations where user1 desires user2's current location OR user2 desires user1's current location
   * Uses cached coordinates for optimal performance
   */
  async isMetroRadiusMatch(user1: User, user2: User): Promise<{
    user1ToUser2Match: boolean;
    user2ToUser1Match: boolean;
    user1LocationOfInterest: string;
    user2LocationOfInterest: string;
  }> {
    let user1ToUser2Match = false;
    let user2ToUser1Match = false;
    let user1LocationOfInterest = '';
    let user2LocationOfInterest = '';

    // Check user1 -> user2 metro radius match (user1 desires user2's current location)
    if (user1.desiredLocationCoords?.length && user1.currentLocationLat && user1.currentLocationLng &&
        user2.currentLocationLat && user2.currentLocationLng) {
      
      const user1CurrentCoord: Coordinates = {
        lat: parseFloat(user1.currentLocationLat),
        lng: parseFloat(user1.currentLocationLng)
      };
      
      const user2CurrentCoord: Coordinates = {
        lat: parseFloat(user2.currentLocationLat),
        lng: parseFloat(user2.currentLocationLng)
      };

      const user1MatchingRadius = user1.matchingRadius ?? 0;

      // ONLY check user1's desired locations that match user2's current location
      for (const coordString of user1.desiredLocationCoords) {
        try {
          const coordData = JSON.parse(coordString);
          
          // CRITICAL: Only check if this desired location matches user2's current location
          if (coordData.location.toLowerCase().trim() !== (user2.currentLocation || '').toLowerCase().trim()) {
            continue; // Skip locations that don't match user2's current location
          }

          const desiredCoord: Coordinates = {
            lat: parseFloat(coordData.lat),
            lng: parseFloat(coordData.lng)
          };

          // Check if user1 is within their own radius of their desired location (which is user2's current location)
          const user1WithinOwnRadius = this.calculateDistance(user1CurrentCoord, desiredCoord) <= user1MatchingRadius;
          
          // Check if user2 is within user1's radius of user2's current location (should be 0 distance)
          const user2WithinUser1Radius = this.calculateDistance(user2CurrentCoord, desiredCoord) <= user1MatchingRadius;

          if (user1WithinOwnRadius && user2WithinUser1Radius) {
            user1ToUser2Match = true;
            user1LocationOfInterest = coordData.location || 'Unknown';
            console.log(`[OptimizedLocationMatcher] Metro radius match for User1: Both users within ${user1MatchingRadius} miles of overlapping location ${user1LocationOfInterest}`);
            break;
          }
        } catch {
          continue;
        }
      }
    }

    // Check user2 -> user1 metro radius match  
    if (user2.desiredLocationCoords?.length && user2.currentLocationLat && user2.currentLocationLng &&
        user1.currentLocationLat && user1.currentLocationLng) {
      
      const user1CurrentCoord: Coordinates = {
        lat: parseFloat(user1.currentLocationLat),
        lng: parseFloat(user1.currentLocationLng)
      };
      
      const user2CurrentCoord: Coordinates = {
        lat: parseFloat(user2.currentLocationLat),
        lng: parseFloat(user2.currentLocationLng)
      };

      const user2MatchingRadius = user2.matchingRadius ?? 0;

      // ONLY check user2's desired locations that match user1's current location
      for (const coordString of user2.desiredLocationCoords) {
        try {
          const coordData = JSON.parse(coordString);
          
          // CRITICAL: Only check if this desired location matches user1's current location
          if (coordData.location.toLowerCase().trim() !== (user1.currentLocation || '').toLowerCase().trim()) {
            continue; // Skip locations that don't match user1's current location
          }

          const desiredCoord: Coordinates = {
            lat: parseFloat(coordData.lat),
            lng: parseFloat(coordData.lng)
          };

          // Check if user2 is within their own radius of their desired location (which is user1's current location)
          const user2WithinOwnRadius = this.calculateDistance(user2CurrentCoord, desiredCoord) <= user2MatchingRadius;
          
          // Check if user1 is within user2's radius of user1's current location (should be 0 distance)
          const user1WithinUser2Radius = this.calculateDistance(user1CurrentCoord, desiredCoord) <= user2MatchingRadius;

          if (user2WithinOwnRadius && user1WithinUser2Radius) {
            user2ToUser1Match = true;
            user2LocationOfInterest = coordData.location || 'Unknown';
            console.log(`[OptimizedLocationMatcher] Metro radius match for User2: Both users within ${user2MatchingRadius} miles of overlapping location ${user2LocationOfInterest}`);
            break;
          }
        } catch {
          continue;
        }
      }
    }

    return {
      user1ToUser2Match,
      user2ToUser1Match,
      user1LocationOfInterest,
      user2LocationOfInterest
    };
  }

  /**
   * Calculate bidirectional relocation match: both users want to relocate within their radius of each other's current location
   * This is used for Templates 1 and 4 (non-metro radius templates)
   */
  async calculateBidirectionalRelocationMatch(user1: User, user2: User): Promise<{
    user1ToUser2LocationMatch: boolean;
    user2ToUser1LocationMatch: boolean;
    bidirectionalLocationMatch: boolean;
    apiCallsSaved: number;
  }> {
    let apiCallsSaved = 0;
    
    try {
      // Check if user1 wants to relocate within their radius of user2's current location
      const user1ToUser2LocationMatch = await this.isUser1WantsToRelocateNearUser2Current(user1, user2);
      
      // Check if user2 wants to relocate within their radius of user1's current location  
      const user2ToUser1LocationMatch = await this.isUser1WantsToRelocateNearUser2Current(user2, user1);
      
      const bidirectionalLocationMatch = user1ToUser2LocationMatch && user2ToUser1LocationMatch;

      // Calculate API calls saved by using cached coordinates
      const potentialApiCalls = (user1.desiredLocations?.length || 0) + (user2.desiredLocations?.length || 0);
      
      if ((user1.currentLocationLat && user1.desiredLocationCoords?.length) ||
          (user2.currentLocationLat && user2.desiredLocationCoords?.length)) {
        apiCallsSaved = potentialApiCalls * 2;
      }

      console.log(`[OptimizedLocationMatcher] Bidirectional relocation matching complete for users ${user1.id} and ${user2.id}: bidirectional=${bidirectionalLocationMatch}, API calls saved=${apiCallsSaved}`);

      return {
        user1ToUser2LocationMatch,
        user2ToUser1LocationMatch,
        bidirectionalLocationMatch,
        apiCallsSaved
      };

    } catch (error) {
      console.error(`[OptimizedLocationMatcher] Error in bidirectional relocation matching:`, error);
      return {
        user1ToUser2LocationMatch: false,
        user2ToUser1LocationMatch: false,
        bidirectionalLocationMatch: false,
        apiCallsSaved: 0
      };
    }
  }

  /**
   * Optimized metro radius matching using cached coordinates
   * Implements the rule: user's current location must be within their matching radius 
   * of their location of interest that caused the match
   */
  async calculateOptimizedLocationMatch(user1: User, user2: User): Promise<{
    user1ToUser2LocationMatch: boolean;
    user2ToUser1LocationMatch: boolean;
    bidirectionalLocationMatch: boolean;
    apiCallsSaved: number;
    user1LocationOfInterest: string;
    user2LocationOfInterest: string;
  }> {
    let apiCallsSaved = 0;
    
    try {
      // Use new metro radius matching logic
      const metroRadiusResult = await this.isMetroRadiusMatch(user1, user2);
      
      const user1ToUser2LocationMatch = metroRadiusResult.user1ToUser2Match;
      const user2ToUser1LocationMatch = metroRadiusResult.user2ToUser1Match;
      const bidirectionalLocationMatch = user1ToUser2LocationMatch && user2ToUser1LocationMatch;

      // Calculate API calls saved by using cached coordinates
      // Each location comparison would normally require 2 geocoding API calls
      const potentialApiCalls = (user1.desiredLocations?.length || 0) + (user2.desiredLocations?.length || 0);
      
      // If we have cached coordinates, we saved all those potential API calls
      if ((user1.currentLocationLat && user1.desiredLocationCoords?.length) ||
          (user2.currentLocationLat && user2.desiredLocationCoords?.length)) {
        apiCallsSaved = potentialApiCalls * 2; // 2 calls per location comparison
      }

      console.log(`[OptimizedLocationMatcher] Metro radius matching complete for users ${user1.id} and ${user2.id}: bidirectional=${bidirectionalLocationMatch}, API calls saved=${apiCallsSaved}`);
      console.log(`[OptimizedLocationMatcher] Locations of interest: User1=${metroRadiusResult.user1LocationOfInterest}, User2=${metroRadiusResult.user2LocationOfInterest}`);

      return {
        user1ToUser2LocationMatch,
        user2ToUser1LocationMatch,
        bidirectionalLocationMatch,
        apiCallsSaved,
        user1LocationOfInterest: metroRadiusResult.user1LocationOfInterest,
        user2LocationOfInterest: metroRadiusResult.user2LocationOfInterest
      };

    } catch (error) {
      console.error(`[OptimizedLocationMatcher] Error in metro radius matching:`, error);
      return {
        user1ToUser2LocationMatch: false,
        user2ToUser1LocationMatch: false,
        bidirectionalLocationMatch: false,
        apiCallsSaved: 0,
        user1LocationOfInterest: '',
        user2LocationOfInterest: ''
      };
    }
  }

  /**
   * Check if this is the specific bidirectional edge case where both users:
   * 1. Have mutual relocation interests (each wants to relocate to other's current location)
   * 2. Both include their own current location in their desired locations
   * 
   * In this case, we should prioritize the relocation swap over staying in place
   */
  private async isBidirectionalEdgeCase(user1: User, user2: User): Promise<boolean> {
    try {
      // First check if both users have the basic requirements
      if (!user1.desiredLocations?.length || !user2.desiredLocations?.length ||
          !user1.currentLocation || !user2.currentLocation) {
        return false;
      }

      // Check if user1 has user2's current location in their desired locations
      const user1WantsUser2Location = user1.desiredLocations.some(location =>
        location.toLowerCase().trim() === (user2.currentLocation || '').toLowerCase().trim()
      );

      // Check if user2 has user1's current location in their desired locations  
      const user2WantsUser1Location = user2.desiredLocations.some(location =>
        location.toLowerCase().trim() === (user1.currentLocation || '').toLowerCase().trim()
      );

      // Check if user1 has their own current location in desired locations
      const user1HasOwnLocationInDesired = user1.desiredLocations.some(location =>
        location.toLowerCase().trim() === (user1.currentLocation || '').toLowerCase().trim()
      );

      // Check if user2 has their own current location in desired locations
      const user2HasOwnLocationInDesired = user2.desiredLocations.some(location =>
        location.toLowerCase().trim() === (user2.currentLocation || '').toLowerCase().trim()
      );

      // This is the edge case if:
      // 1. Both users want to relocate to each other's location (bidirectional interest)
      // 2. Both users also have their own current location in their desired locations
      const isEdgeCase = user1WantsUser2Location && user2WantsUser1Location && 
                        user1HasOwnLocationInDesired && user2HasOwnLocationInDesired;

      if (isEdgeCase) {
        console.log(`[OptimizedLocationMatcher] Bidirectional edge case detected between users ${user1.id} and ${user2.id}:`);
        console.log(`[OptimizedLocationMatcher] - ${user1.fullName} wants ${user2.currentLocation} (where ${user2.fullName} lives) and has ${user1.currentLocation} in desired`);
        console.log(`[OptimizedLocationMatcher] - ${user2.fullName} wants ${user1.currentLocation} (where ${user1.fullName} lives) and has ${user2.currentLocation} in desired`);
        console.log(`[OptimizedLocationMatcher] - Will prioritize relocation swap over staying in place`);
      }

      return isEdgeCase;
    } catch (error) {
      console.error(`[OptimizedLocationMatcher] Error checking bidirectional edge case:`, error);
      return false;
    }
  }

  /**
   * PERFORMANCE OPTIMIZED: Batch process location caching for multiple users
   * This eliminates the N+1 query problem that was causing synergy match delays
   */
  async batchEnsureUserLocationsCached(users: User[]): Promise<void> {
    try {
      console.log(`[OptimizedLocationMatcher] Batch caching locations for ${users.length} users`);
      
      // Separate users that need current location caching vs desired location caching
      const usersNeedingCurrentLocation = users.filter(user => 
        user.currentLocation && (!user.currentLocationLat || !user.currentLocationLng)
      );
      
      const usersNeedingDesiredLocations = users.filter(user => 
        user.desiredLocations?.length && !user.desiredLocationCoords?.length
      );

      // Process current locations in parallel
      if (usersNeedingCurrentLocation.length > 0) {
        console.log(`[OptimizedLocationMatcher] Batch processing ${usersNeedingCurrentLocation.length} current locations`);
        await Promise.all(
          usersNeedingCurrentLocation.map(user => 
            locationCacheService.updateUserCurrentLocation(user.id, user.currentLocation!)
          )
        );
      }

      // Process desired locations in parallel  
      if (usersNeedingDesiredLocations.length > 0) {
        console.log(`[OptimizedLocationMatcher] Batch processing desired locations for ${usersNeedingDesiredLocations.length} users`);
        await Promise.all(
          usersNeedingDesiredLocations.map(user => 
            locationCacheService.updateUserDesiredLocations(user.id, user.desiredLocations!)
          )
        );
      }
      
      console.log(`[OptimizedLocationMatcher] Batch caching completed successfully`);
    } catch (error) {
      console.error(`[OptimizedLocationMatcher] Error in batch caching locations:`, error);
    }
  }

  /**
   * Legacy single-user method - now uses batch processing internally
   */
  async ensureUserLocationsCached(user: User): Promise<void> {
    return this.batchEnsureUserLocationsCached([user]);
  }
}

export const optimizedLocationMatcher = new OptimizedLocationMatcher();