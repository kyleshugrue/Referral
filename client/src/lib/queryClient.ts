import { QueryClient, QueryFunction } from "@tanstack/react-query";
import * as firebaseLib from "./firebase";
import { config } from "./config";
import { getCurrentAccessToken, refreshAccessToken, waitForTokensReady, isRefreshInProgress, waitForRefreshComplete } from './token-manager';
import { Capacitor } from "@capacitor/core";

/**
 * Convert relative URLs to absolute URLs using the configured API base URL
 * For native platforms, prepends the production backend URL
 * For web platforms, leaves relative URLs as-is (they work correctly)
 */
function getAbsoluteUrl(url: string): string {
  // If URL is already absolute (starts with http:// or https://), return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // For any relative URL (doesn't start with http/https), prepend the API base URL
  // Handle both URLs with leading slash (/api/...) and without (api/...)
  const normalizedUrl = url.startsWith('/') ? url : `/${url}`;
  const absoluteUrl = `${config.apiBaseUrl}${normalizedUrl}`;
  
  console.log(`[ApiRequest] Converted relative URL "${url}" to absolute URL "${absoluteUrl}"`);
  return absoluteUrl;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorText = res.statusText;
    
    try {
      // Try to get more specific error message from response
      const text = await res.text();
      if (text) {
        // Check if it's JSON
        try {
          const json = JSON.parse(text);
          errorText = json.message || json.error || text;
        } catch {
          // If not JSON, use the raw text
          errorText = text;
        }
      }
    } catch (e) {
      console.error("Error parsing error response:", e);
    }
    
    console.error(`API request failed with status ${res.status}: ${errorText}`);
    throw new Error(`${res.status}: ${errorText}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  retryCount: number = 0,
  maxRetries: number = 2
): Promise<Response> {
  // CRITICAL: Wait for token initialization to complete before making requests
  // This prevents race condition on iOS app startup where queries fire before tokens load
  await waitForTokensReady();
  
  // Add additional logs for debugging connection requests
  const isConnectionRequest = url.includes('/connections/request/');
  if (isConnectionRequest) {
    console.log(`Attempting connection request [Attempt ${retryCount + 1}/${maxRetries + 1}]: ${method} ${url}`);
  }

  try {
    // Setup headers
    const headers: Record<string, string> = {};
    if (data) {
      headers["Content-Type"] = "application/json";
    }
    
    // Add platform detection headers for backend routing
    try {
      const platform = Capacitor.getPlatform();
      const isNativePlatform = Capacitor.isNativePlatform();
      
      // Only set iOS native header for actual Capacitor iOS native apps
      if (platform === 'ios' && isNativePlatform) {
        headers["X-Platform"] = "ios-native";
        headers["X-Capacitor-Platform"] = platform;
        console.log('[ApiRequest] Adding iOS native platform headers');
      } else {
        headers["X-Platform"] = "web";
        headers["X-Capacitor-Platform"] = platform;
      }
    } catch {
      // If Capacitor is not available, assume web platform
      headers["X-Platform"] = "web";
      console.debug('[ApiRequest] Capacitor not available, assuming web platform');
    }
    
    // Get JWT access token for mobile authentication
    const accessToken = getCurrentAccessToken();
    
    // Prioritize JWT token over Firebase token
    const fbUser = firebaseLib.auth?.currentUser;
    if (accessToken && accessToken !== 'PENDING_REFRESH') {
      headers["Authorization"] = `Bearer ${accessToken}`;
      console.log('[ApiRequest] Using JWT access token for authentication');
    } else if (fbUser) {
      // Fallback to Firebase auth token if no JWT token (web platform)
      try {
        const token = await fbUser.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
        console.log('[ApiRequest] Using Firebase token for authentication');
      } catch (error) {
        console.warn("Failed to get Firebase token:", error);
      }
    }

    // Convert relative URL to absolute URL for native platforms
    const absoluteUrl = getAbsoluteUrl(url);

    let res = await fetch(absoluteUrl, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    // Handle 401: Attempt token refresh once (JWT only, iOS native)
    if (res.status === 401 && accessToken && accessToken !== 'PENDING_REFRESH') {
      console.log(`[API] Got 401 for ${method} ${url}, attempting token refresh`);
      
      // CRITICAL: Check if another refresh is already in progress (synchronous lock)
      // All 401 callers should wait on the same refresh to prevent race conditions
      let newAccessToken: string | null;
      if (isRefreshInProgress()) {
        console.log('[API] Refresh lock active, waiting for shared refresh to complete');
        newAccessToken = await waitForRefreshComplete();
      } else {
        console.log('[API] No refresh in progress, initiating refresh');
        newAccessToken = await refreshAccessToken();
      }
      
      // CRITICAL: Always re-read the fresh token from the manager after refresh
      // This ensures we get the token that was set during the successful refresh
      const freshToken = getCurrentAccessToken();
      
      console.log(`[API] Refresh complete. Fresh token available: ${!!freshToken}`);
      
      if (freshToken && freshToken !== accessToken) {
        // Retry request with the FRESH token from token manager
        console.log(`[API] Retrying ${method} ${url} with fresh token`);
        headers["Authorization"] = `Bearer ${freshToken}`;
        
        res = await fetch(absoluteUrl, {
          method,
          headers,
          body: data ? JSON.stringify(data) : undefined,
          credentials: "include",
        });
        
        console.log(`[API] Retry result: ${res.status} for ${method} ${url}`);
      } else if (newAccessToken) {
        // Fallback to the returned token if getCurrentAccessToken doesn't have it yet
        console.log(`[API] Using returned token for retry`);
        headers["Authorization"] = `Bearer ${newAccessToken}`;
        
        res = await fetch(absoluteUrl, {
          method,
          headers,
          body: data ? JSON.stringify(data) : undefined,
          credentials: "include",
        });
        
        console.log(`[API] Retry result: ${res.status} for ${method} ${url}`);
      } else {
        // Refresh failed - logout will be triggered by token manager
        console.error('[API] Token refresh failed completely, logout will be triggered');
      }
    }

    // For connection requests, handle specific response codes differently
    if (isConnectionRequest && !res.ok) {
      // Already have a connection request
      if (res.status === 400) {
        const errorData = await res.json();
        if (errorData.message === "DUPLICATE_REQUEST") {
          console.log("Duplicate connection request detected - returning success");
          // Return a successful response to the client so UI shows request as sent
          return new Response(JSON.stringify({ success: true, isDuplicate: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Retry logic for network failures and 5xx errors
      if ((res.status >= 500 || res.status === 0) && retryCount < maxRetries) {
        console.log(`Connection request failed with status ${res.status}. Retrying (${retryCount + 1}/${maxRetries})...`);
        // Wait longer between each retry
        const delay = Math.min(1000 * Math.pow(2, retryCount), 4000);
        await new Promise(resolve => setTimeout(resolve, delay));
        return apiRequest(method, url, data, retryCount + 1, maxRetries);
      }
    }

    await throwIfResNotOk(res);
    return res;
  } catch (err) {
    // Special retry logic for connection requests on any connection error
    if (isConnectionRequest && retryCount < maxRetries) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.log(`Connection request error: ${errorMessage}. Retrying (${retryCount + 1}/${maxRetries})...`);
      // Exponential backoff with a cap
      const delay = Math.min(1000 * Math.pow(2, retryCount), 4000);
      await new Promise(resolve => setTimeout(resolve, delay));
      return apiRequest(method, url, data, retryCount + 1, maxRetries);
    }
    throw err;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    // CRITICAL: Wait for token initialization to complete before making queries
    // This prevents race condition on iOS app startup where queries fire before tokens load
    await waitForTokensReady();
    
    // Handle different query key formats
    let url = "";
    
    if (typeof queryKey[0] === 'string') {
      // Format 1: First element is a complete URL with no params
      if (queryKey[0].startsWith('/api/') && queryKey.length === 1) {
        url = queryKey[0];
      } 
      // Format 2: First element is the API endpoint, second is an ID parameter
      else if (queryKey[0].startsWith('/api/') && queryKey.length > 1 && typeof queryKey[1] === 'number') {
        url = `${queryKey[0]}/${queryKey[1]}`;
      }
      // Format 3: For non-API endpoints
      else if (!queryKey[0].startsWith('/api/')) {
        url = queryKey[0];
      }
    }
    
    console.log('[QueryClient] Fetching URL:', url, 'from queryKey:', queryKey);
    
    // Setup headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Add platform detection headers for backend routing
    try {
      const platform = Capacitor.getPlatform();
      const isNativePlatform = Capacitor.isNativePlatform();
      
      // Only set iOS native header for actual Capacitor iOS native apps
      if (platform === 'ios' && isNativePlatform) {
        headers["X-Platform"] = "ios-native";
        headers["X-Capacitor-Platform"] = platform;
      } else {
        headers["X-Platform"] = "web";
        headers["X-Capacitor-Platform"] = platform;
      }
    } catch {
      // If Capacitor is not available, assume web platform
      headers["X-Platform"] = "web";
      console.debug('[QueryClient] Capacitor not available, assuming web platform');
    }
    
    // Get JWT access token for mobile authentication
    const jwtAccessToken = getCurrentAccessToken();
    
    // Prioritize JWT token over Firebase token
    const fbUser = firebaseLib.auth?.currentUser;
    if (jwtAccessToken && jwtAccessToken !== 'PENDING_REFRESH') {
      headers["Authorization"] = `Bearer ${jwtAccessToken}`;
      console.log('[QueryClient] Using JWT access token for authentication');
    } else if (fbUser) {
      // Fallback to Firebase auth token if no JWT token (web platform)
      try {
        const token = await fbUser.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
        console.log('[QueryClient] Using Firebase token for authentication');
      } catch (error) {
        console.warn("Failed to get Firebase token for query:", error);
      }
    }
    
    // Convert relative URL to absolute URL for native platforms
    const absoluteUrl = getAbsoluteUrl(url);
    
    // Make the request
    let res = await fetch(absoluteUrl, {
      headers,
      signal,
      credentials: "include",
    });

    // Handle 401: Attempt token refresh once (JWT only, iOS native)
    if (res.status === 401 && jwtAccessToken && jwtAccessToken !== 'PENDING_REFRESH') {
      console.log(`[QueryClient] Query got 401 for ${url}, attempting token refresh`);
      
      // CRITICAL: Check if another refresh is already in progress (synchronous lock)
      // All 401 callers should wait on the same refresh to prevent race conditions
      let newAccessToken: string | null;
      if (isRefreshInProgress()) {
        console.log('[QueryClient] Refresh lock active, waiting for shared refresh to complete');
        newAccessToken = await waitForRefreshComplete();
      } else {
        console.log('[QueryClient] No refresh in progress, initiating refresh');
        newAccessToken = await refreshAccessToken();
      }
      
      // CRITICAL: Always re-read the fresh token from the manager after refresh
      // This ensures we get the token that was set during the successful refresh
      const freshToken = getCurrentAccessToken();
      
      console.log(`[QueryClient] Refresh complete. Fresh token available: ${!!freshToken}`);
      
      if (freshToken && freshToken !== jwtAccessToken) {
        // Retry request with the FRESH token from token manager
        console.log(`[QueryClient] Retrying query ${url} with fresh token`);
        headers["Authorization"] = `Bearer ${freshToken}`;
        
        res = await fetch(absoluteUrl, {
          headers,
          signal,
          credentials: "include",
        });
        
        console.log(`[QueryClient] Retry result: ${res.status} for query ${url}`);
      } else if (newAccessToken) {
        // Fallback to the returned token if getCurrentAccessToken doesn't have it yet
        console.log(`[QueryClient] Using returned token for retry`);
        headers["Authorization"] = `Bearer ${newAccessToken}`;
        
        res = await fetch(absoluteUrl, {
          headers,
          signal,
          credentials: "include",
        });
        
        console.log(`[QueryClient] Retry result: ${res.status} for query ${url}`);
      } else {
        // Refresh failed - logout will be triggered by token manager
        console.error('[QueryClient] Token refresh failed completely for query');
      }
    }

    // Handle custom 401 behavior
    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    
    // Parse response based on content type
    const contentType = res.headers.get('Content-Type');
    if (contentType && contentType.includes('application/json')) {
      return await res.json();
    }
    
    return await res.text();
  };

// Standard query configurations for different data types
export const QUERY_CONFIGS = {
  // For frequently changing data like connection requests
  CONNECTION_DATA: {
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // 1 minute
    retry: 2,
    refetchOnWindowFocus: true,
    refetchOnMount: true
  },
  // For user profile and relatively static data
  USER_DATA: {
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchInterval: false,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always'
  },
  // For notification counts (needs frequent updates)
  NOTIFICATION_DATA: {
    staleTime: 1000 * 15, // 15 seconds
    refetchInterval: 1000 * 30, // 30 seconds
    retry: 2,
    refetchOnWindowFocus: true,
    refetchOnMount: true
  }
};

// Enhanced QueryClient configuration for improved data synchronization
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 1000 * 60 * 2, // Default 2 minutes
      retry: 1,
      refetchOnMount: true
    },
    mutations: {
      retry: 1,
      // Automatically update relevant queries after mutations
      onSuccess: () => {
        // Override in specific mutations as needed
      },
    },
  },
});

// Optimized function to selectively synchronize user-related data
export const synchronizeUserData = async (specificQueries?: string[]) => {
  console.log("Synchronizing user-related data", specificQueries ? `for: ${specificQueries.join(', ')}` : "(all)");
  
  if (specificQueries) {
    // Only invalidate specific queries if provided
    for (const queryKey of specificQueries) {
      await queryClient.invalidateQueries({ queryKey: [queryKey] });
    }
  } else {
    // Invalidate user data first
    await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    
    // Then invalidate only essential related data to reduce cascade effects
    await queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
  }
  
  // Dispatch a global event for components to know data was refreshed
  window.dispatchEvent(new CustomEvent('app-data-refreshed'));
  
  return true;
};

// Helper function to reduce excessive cache invalidations
export const optimizedInvalidateQueries = async (queryKeys: string[]) => {
  // Batch invalidations and add delay to prevent cascade effects
  const uniqueKeys = [...new Set(queryKeys)];
  
  for (const queryKey of uniqueKeys) {
    queryClient.invalidateQueries({ queryKey: [queryKey] });
    // Small delay between invalidations to prevent overwhelming the system
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
