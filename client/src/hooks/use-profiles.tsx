import { useQuery } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

interface SearchCriteria {
  industry?: string;
  location?: string;
  company?: string;
  yearsOfExperience?: number;
  title?: string;
  name?: string;
}

interface ProfilesResponse {
  profiles: User[];
  hasMore: boolean;
}

// Connection request cache to persist request status across page navigations
// Uses optimistic flag and timestamp to protect unconfirmed entries from race conditions during sync
interface CacheEntry {
  userId: number;
  confirmed: boolean; // true once the server has acknowledged this request
  timestamp?: number; // when the entry was created (for optimistic entry aging)
}

// How long to protect optimistic entries before considering them stale (30 seconds)
const OPTIMISTIC_ENTRY_MAX_AGE_MS = 30000;

type CacheUpdateListener = (userIds: number[]) => void;
const cacheListeners: Set<CacheUpdateListener> = new Set();

// Emit cache update event to all listeners
const emitCacheUpdate = (userIds: number[]) => {
  cacheListeners.forEach(listener => {
    try {
      listener(userIds);
    } catch (e) {
      console.error('Error in cache listener:', e);
    }
  });
};

export const connectionRequestCache = {
  // Get raw cache entries
  _getRawCache: (): CacheEntry[] => {
    try {
      const cachedData = localStorage.getItem('pendingConnectionRequestsV3');
      if (cachedData) {
        return JSON.parse(cachedData);
      }
      // Migration: check for V2 format
      const v2Cache = localStorage.getItem('pendingConnectionRequestsV2');
      if (v2Cache) {
        const v2Entries = JSON.parse(v2Cache);
        const migrated: CacheEntry[] = v2Entries.map((e: { userId: number }) => ({ userId: e.userId, confirmed: true }));
        localStorage.setItem('pendingConnectionRequestsV3', JSON.stringify(migrated));
        localStorage.removeItem('pendingConnectionRequestsV2');
        return migrated;
      }
      // Migration: check for V1 format
      const oldCache = localStorage.getItem('pendingConnectionRequests');
      if (oldCache) {
        const oldIds: number[] = JSON.parse(oldCache);
        const migrated: CacheEntry[] = oldIds.map(userId => ({ userId, confirmed: true }));
        localStorage.setItem('pendingConnectionRequestsV3', JSON.stringify(migrated));
        localStorage.removeItem('pendingConnectionRequests');
        return migrated;
      }
      return [];
    } catch (e) {
      console.error('Error reading connection request cache', e);
      return [];
    }
  },
  
  // Save raw cache entries
  _saveRawCache: (entries: CacheEntry[]): void => {
    localStorage.setItem('pendingConnectionRequestsV3', JSON.stringify(entries));
  },
  
  // Get all pending connection requests (user IDs only)
  // Note: This is a pure read operation - no side effects
  getPendingRequests: (): number[] => {
    const entries = connectionRequestCache._getRawCache();
    return entries.map(e => e.userId);
  },
  
  // Add a user ID to the pending requests (optimistic - not yet confirmed by server)
  addPendingRequest: (userId: number): void => {
    try {
      console.log('Adding user ID to pending connection requests:', userId);
      const entries = connectionRequestCache._getRawCache();
      const exists = entries.some(e => e.userId === userId);
      
      if (!exists) {
        const newEntry: CacheEntry = { userId, confirmed: false, timestamp: Date.now() };
        const updatedEntries = [...entries, newEntry];
        connectionRequestCache._saveRawCache(updatedEntries);
        const newUserIds = updatedEntries.map(e => e.userId);
        console.log('Updated pending connection requests:', newUserIds);
        // Emit cache update to notify subscribers
        emitCacheUpdate(newUserIds);
      } else {
        console.log('User ID already in pending requests, skipping update');
      }
    } catch (e) {
      console.error('Error adding to connection request cache', e);
    }
  },
  
  // Remove a user ID from pending requests
  removePendingRequest: (userId: number): void => {
    try {
      console.log('Removing user ID from pending connection requests:', userId);
      const entries = connectionRequestCache._getRawCache();
      const updatedEntries = entries.filter(e => e.userId !== userId);
      connectionRequestCache._saveRawCache(updatedEntries);
      const newUserIds = updatedEntries.map(e => e.userId);
      console.log('Updated pending connection requests after removal:', newUserIds);
      // Emit cache update to notify subscribers
      emitCacheUpdate(newUserIds);
    } catch (e) {
      console.error('Error removing from connection request cache', e);
    }
  },
  
  // Subscribe to cache updates
  subscribe: (listener: CacheUpdateListener): (() => void) => {
    cacheListeners.add(listener);
    return () => {
      cacheListeners.delete(listener);
    };
  },
  
  // Update the cache with server data (from outgoing requests)
  // Logic:
  // - Entries on server: keep/mark as confirmed
  // - Fresh optimistic entries (< 30s old) NOT on server: keep (race condition protection)
  // - Stale optimistic entries (> 30s old) NOT on server: prune (request was rejected)
  // - Confirmed entries NOT on server: prune (request was rejected/canceled)
  syncWithServerData: (serverRequestedUserIds: number[]): void => {
    try {
      console.log('Syncing connection request cache with server data:', serverRequestedUserIds);
      
      const existingEntries = connectionRequestCache._getRawCache();
      const serverIdSet = new Set(serverRequestedUserIds);
      const now = Date.now();
      
      // Build confirmed entries from server data
      const confirmedEntries: CacheEntry[] = serverRequestedUserIds.map(userId => ({
        userId,
        confirmed: true,
        timestamp: now
      }));
      
      // Only keep FRESH optimistic entries that are NOT yet on server (race condition protection)
      // Prune stale optimistic entries that have been waiting too long for confirmation
      const freshOptimisticEntries = existingEntries.filter(entry => {
        // Skip confirmed entries - they'll be replaced by server data
        if (entry.confirmed) return false;
        
        // Skip if already on server - will be in confirmedEntries
        if (serverIdSet.has(entry.userId)) return false;
        
        // Check if this optimistic entry is still fresh (within race condition window)
        const entryAge = now - (entry.timestamp || 0);
        const isFresh = entryAge < OPTIMISTIC_ENTRY_MAX_AGE_MS;
        
        if (!isFresh) {
          console.log(`Pruning stale optimistic entry for user ${entry.userId} (age: ${Math.round(entryAge / 1000)}s)`);
        }
        
        return isFresh;
      });
      
      const finalEntries = [...confirmedEntries, ...freshOptimisticEntries];
      connectionRequestCache._saveRawCache(finalEntries);
      const newUserIds = finalEntries.map(e => e.userId);
      console.log('Updated pending connection requests from server:', finalEntries.map(e => `${e.userId}(${e.confirmed ? 'confirmed' : 'optimistic'})`));
      // Emit cache update to notify subscribers about the synced state
      emitCacheUpdate(newUserIds);
    } catch (e) {
      console.error('Error syncing connection request cache', e);
    }
  },
  
  // Sync with server by fetching outgoing requests
  syncWithServer: async (): Promise<void> => {
    try {
      console.log('Attempting to sync connection request cache with server');
      const response = await fetch('/api/connections/outgoing', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const outgoingRequests = await response.json();
        const receiverIds = (outgoingRequests as Array<{ receiverId: number }>).map(req => req.receiverId);
        
        console.log('Found outgoing requests from server:', receiverIds);
        connectionRequestCache.syncWithServerData(receiverIds);
      } else {
        console.warn('Failed to sync connection requests from server:', response.status);
      }
    } catch (e) {
      console.error('Error during server sync of connection requests:', e);
    }
  },
  
  // Check if a user ID is in the pending requests
  isPending: (userId: number): boolean => {
    const pendingRequests = connectionRequestCache.getPendingRequests();
    const result = pendingRequests.includes(userId);
    console.log(`Connection request cache check: User ${userId} is ${result ? 'pending' : 'not pending'}`);
    return result;
  }
};

export function useProfiles(page = 1, perPage = 10) {
  const { user } = useAuth();

  const { data, isLoading, error, refetch } = useQuery<ProfilesResponse>({
    queryKey: ["/api/network/potential", page, perPage],
    queryFn: async () => {
      if (!user) {
        throw new Error("User must be authenticated to fetch profiles");
      }

      const response = await apiRequest(
        "GET",
        `/api/network/potential?page=${page}&perPage=${perPage}`
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to fetch profiles: ${error}`);
      }

      const data = await response.json();
      return {
        profiles: data.profiles || [],
        hasMore: data.hasMore || false
      };
    },
    staleTime: 60000, // Cache for 1 minute
    enabled: !!user, // Only run query when user is authenticated
    retry: 3, // Add retry attempts
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000) // Exponential backoff
  });

  const updateSearchCriteria = async (criteria: SearchCriteria) => {
    try {
      const updatedCriteria: Partial<User> = {};

      if (criteria.industry && criteria.industry !== "any") {
        updatedCriteria.industry = criteria.industry;
      }
      if (criteria.location?.trim()) {
        updatedCriteria.currentLocation = criteria.location;
      }
      if (criteria.company?.trim()) {
        updatedCriteria.currentCompany = criteria.company;
      }
      if (criteria.yearsOfExperience && criteria.yearsOfExperience > 0) {
        updatedCriteria.yearsOfExperience = criteria.yearsOfExperience;
      }
      if (criteria.title?.trim()) {
        updatedCriteria.title = criteria.title;
      }
      if (criteria.name?.trim()) {
        updatedCriteria.fullName = criteria.name;
      }

      const queryParams = new URLSearchParams(updatedCriteria as Record<string, string>);
      await apiRequest("GET", `/api/network/potential?${queryParams}`);

      // Invalidate all pages when search criteria changes
      await queryClient.invalidateQueries({ 
        queryKey: ["/api/network/potential"],
        exact: false
      });
    } catch (error) {
      console.error("Failed to update search criteria:", error);
      throw error;
    }
  };

  return {
    profiles: data?.profiles || [],
    hasMore: data?.hasMore || false,
    isLoading,
    error,
    refetch,
    updateSearchCriteria
  };
}