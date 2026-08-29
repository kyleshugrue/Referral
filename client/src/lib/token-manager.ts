/**
 * Token Manager
 * Centralized JWT token lifecycle management for mobile and web platforms
 * 
 * Handles:
 * - Secure storage of refresh tokens on iOS (using Keychain)
 * - In-memory access token management
 * - Automatic token refresh before expiration
 * - Token change notification system
 */

import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { config } from './config';
import { logger } from './logger';
import { toast } from '@/hooks/use-toast';

export interface TokenData {
  accessToken: string;
  refreshToken?: string; // Only stored on iOS
  deviceId?: string; // Device ID for token refresh (required by server)
  expiresAt: number; // Unix timestamp in milliseconds
}

// In-Memory State
let currentAccessToken: string | null = null;
let tokenExpiresAt: number | null = null;

// Token Loading State (prevents race condition on app startup)
let isLoadingTokens: boolean = false;
let tokenReadyResolve: (() => void) | null = null;
let tokenReadyPromise: Promise<void> | null = null;

// Listeners for token changes
const listeners = new Set<(token: string | null) => void>();

// Refresh mutex to prevent concurrent refresh attempts
// CRITICAL: Uses synchronous lock pattern to prevent race conditions
let refreshLock: boolean = false;  // Synchronous flag - set IMMEDIATELY before any async work
let refreshDeferred: Promise<string | null> | null = null;  // Shared promise for all waiters
let resolveRefresh: ((value: string | null) => void) | null = null;  // Resolver for deferred promise

// Legacy flag for backwards compatibility
let isRefreshing: boolean = false;

// Auto-refresh timer
let refreshTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null; // Track retry timer for network/transient errors

// Constants
const REFRESH_TOKEN_KEY = 'refresh_token';
const REFRESH_BUFFER_MS = 60000; // Refresh 1 minute before expiry
const INIT_TIMEOUT_MS = 3000; // Maximum time to wait for token initialization (3 seconds)

/**
 * Platform Detection
 * Returns true if running on native iOS platform
 */
function isNativeiOS(): boolean {
  return Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
}

/**
 * JWT Decoding
 * Decode JWT to extract exp claim and other payload data
 */
function decodeJWT(token: string): { exp?: number; userId?: number } {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload;
  } catch (error) {
    logger.error('[TokenManager] Failed to decode JWT:', error);
    return {};
  }
}

/**
 * Clear Refresh Timer
 * Cancels any scheduled token refresh and retry timers
 */
function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    logger.debug('[TokenManager] Refresh timer cleared');
  }
  
  // Clear retry timer
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
    logger.debug('[TokenManager] Retry timer cleared');
  }
}

/**
 * Schedule Refresh
 * Schedules automatic token refresh before expiration
 */
function scheduleRefresh(expiresAt: number) {
  clearRefreshTimer();
  
  const now = Date.now();
  const refreshTime = expiresAt - REFRESH_BUFFER_MS; // 1 minute before expiry
  const delay = Math.max(0, refreshTime - now);
  
  logger.debug('[TokenManager] Scheduling token refresh:', {
    expiresAt: new Date(expiresAt).toISOString(),
    refreshTime: new Date(refreshTime).toISOString(),
    delayMs: delay
  });
  
  refreshTimer = setTimeout(() => {
    logger.debug('[TokenManager] Auto-refresh triggered');
    refreshAccessToken();
  }, delay);
}

/**
 * Notify Listeners
 * Notifies all registered listeners of token changes
 */
function notifyListeners(token: string | null) {
  logger.debug('[TokenManager] Notifying listeners:', {
    listenerCount: listeners.size,
    hasToken: !!token
  });
  
  listeners.forEach(callback => {
    try {
      callback(token);
    } catch (error) {
      logger.error('[TokenManager] Error in listener callback:', error);
    }
  });
}

/**
 * Mark Token Initialization Complete
 * Resolves the tokenReadyPromise to signal that tokens are ready (or loading failed)
 */
function markTokensReady() {
  logger.debug('[TokenManager] Marking tokens as ready');
  isLoadingTokens = false;
  
  if (tokenReadyResolve) {
    tokenReadyResolve();
    tokenReadyResolve = null;
  }
}

/**
 * Wait For Tokens Ready
 * Returns a promise that resolves when token initialization completes
 * Includes timeout to prevent infinite waiting
 * 
 * @returns Promise that resolves when tokens are loaded or timeout occurs
 */
export async function waitForTokensReady(): Promise<void> {
  // Only wait on iOS native platform
  if (!isNativeiOS()) {
    logger.debug('[TokenManager] Web platform - skipping token wait');
    return Promise.resolve();
  }
  
  // If not currently loading, tokens are ready
  if (!isLoadingTokens) {
    logger.debug('[TokenManager] Tokens already ready');
    return Promise.resolve();
  }
  
  logger.debug('[TokenManager] Waiting for tokens to finish loading...');
  
  // Wait for either token loading to complete or timeout
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.warn('[TokenManager] Token initialization timeout after', INIT_TIMEOUT_MS, 'ms');
      resolve();
    }, INIT_TIMEOUT_MS);
  });
  
  // Race between token ready and timeout
  await Promise.race([tokenReadyPromise, timeoutPromise]);
  
  // Clean up timeout to prevent spurious warnings
  clearTimeout(timeoutId!);
  
  logger.debug('[TokenManager] Token wait completed');
}

/**
 * Get Token Loading Status
 * Returns true if tokens are currently being loaded
 */
export function getIsLoadingTokens(): boolean {
  return isLoadingTokens;
}

/**
 * Load Tokens
 * Loads tokens from SecureStorage (iOS) or returns null (web)
 * Attempts to refresh on app start, but preserves refresh token on failure
 * CRITICAL: Never clears tokens due to network failures (prevents offline lockout)
 */
export async function loadTokens(): Promise<TokenData | null> {
  try {
    // Only load tokens on iOS native platform
    if (!isNativeiOS()) {
      logger.debug('[TokenManager] Not iOS native, skipping token load (web uses session cookies)');
      markTokensReady(); // Mark ready immediately for web
      return null;
    }
    
    // Set loading state and create promise
    logger.debug('[TokenManager] Starting token initialization...');
    isLoadingTokens = true;
    tokenReadyPromise = new Promise<void>((resolve) => {
      tokenReadyResolve = resolve;
    });
    
    logger.debug('[TokenManager] Loading tokens from SecureStorage');
    
    // Load refresh token from SecureStorage
    const result = await SecureStorage.get(REFRESH_TOKEN_KEY);
    
    if (!result || typeof result !== 'string') {
      logger.debug('[TokenManager] No refresh token found in SecureStorage');
      markTokensReady();
      return null;
    }
    
    // Parse the stored token data
    const tokenData = JSON.parse(result) as TokenData;
    
    // Validate token data
    if (!tokenData.refreshToken) {
      logger.warn('[TokenManager] Invalid token data in SecureStorage, clearing');
      await clearTokens();
      markTokensReady();
      return null;
    }
    
    logger.debug('[TokenManager] Refresh token found, attempting immediate refresh to get fresh access token');
    
    // Attempt to refresh immediately to get fresh access token
    // BUT: Don't clear tokens if refresh fails (could be network issue)
    const accessToken = await refreshAccessToken();
    
    if (accessToken) {
      // SUCCESS: Return loaded tokens with fresh access token
      const decoded = decodeJWT(accessToken);
      const expiresAt = decoded.exp ? decoded.exp * 1000 : Date.now() + 15 * 60 * 1000;
      
      // CRITICAL: Schedule next refresh
      scheduleRefresh(expiresAt);
      
      logger.debug('[TokenManager] Tokens loaded successfully with fresh access token:', {
        expiresAt: new Date(expiresAt).toISOString(),
        refreshScheduled: new Date(expiresAt - REFRESH_BUFFER_MS).toISOString()
      });
      
      markTokensReady();
      
      return {
        accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt,
      };
    } else if (tokenData.accessToken) {
      // OFFLINE/FAILED: Use stored access token (may be expired)
      logger.warn('[TokenManager] Refresh failed (offline), using stored access token to maintain authentication');
      
      // Decode stored access token to get expiry
      const decoded = decodeJWT(tokenData.accessToken);
      const expiresAt = decoded.exp ? decoded.exp * 1000 : Date.now();
      
      // CRITICAL: Update in-memory state to prevent logout
      currentAccessToken = tokenData.accessToken;
      tokenExpiresAt = expiresAt;
      
      // Schedule immediate refresh (will retry when online)
      scheduleRefresh(Date.now());
      
      logger.debug('[TokenManager] Using stored access token for offline access:', {
        expiresAt: new Date(expiresAt).toISOString(),
        immediateRefreshScheduled: true
      });
      
      markTokensReady();
      
      // Return stored tokens so AuthProvider knows user is authenticated
      return {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt,
      };
    } else {
      // No stored access token available - cannot recover
      logger.error('[TokenManager] No stored access token available, cannot maintain offline authentication');
      markTokensReady();
      return null;
    }
  } catch (error) {
    logger.error('[TokenManager] Error loading tokens:', error);
    markTokensReady();
    return null;
  }
}

/**
 * Set Tokens
 * Stores tokens in SecureStorage (iOS) and memory
 */
export async function setTokens(data: TokenData): Promise<void> {
  try {
    // Validate token data
    if (!data.accessToken) {
      throw new Error('Access token is required');
    }
    
    // Decode JWT to extract expiration if not provided
    let expiresAt = data.expiresAt;
    if (!expiresAt) {
      const decoded = decodeJWT(data.accessToken);
      if (decoded.exp) {
        expiresAt = decoded.exp * 1000; // Convert to milliseconds
        logger.debug('[TokenManager] Extracted expiration from JWT:', new Date(expiresAt).toISOString());
      } else {
        // Default to 15 minutes if no expiration found
        expiresAt = Date.now() + 15 * 60 * 1000;
        logger.warn('[TokenManager] No expiration in JWT, using default 15 minutes');
      }
    }
    
    // Store in memory
    currentAccessToken = data.accessToken;
    tokenExpiresAt = expiresAt;
    
    // CRITICAL: Always schedule refresh timer
    scheduleRefresh(expiresAt);
    
    // Store refresh token in SecureStorage only on iOS
    if (isNativeiOS() && data.refreshToken) {
      logger.debug('[TokenManager] Storing refresh token in SecureStorage');
      
      const tokenData: TokenData = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        deviceId: data.deviceId, // Store deviceId for token refresh
        expiresAt
      };
      
      await SecureStorage.set(REFRESH_TOKEN_KEY, JSON.stringify(tokenData));
      
      logger.debug('[TokenManager] Refresh token stored successfully', { hasDeviceId: !!data.deviceId });
    } else if (isNativeiOS()) {
      logger.warn('[TokenManager] No refresh token provided for iOS storage');
    } else {
      logger.debug('[TokenManager] Skipping SecureStorage (web platform uses session cookies)');
    }
    
    // Notify listeners
    notifyListeners(data.accessToken);
    
    // Mark tokens as ready (in case this is called during initial load)
    markTokensReady();
    
    logger.debug('[TokenManager] Tokens stored successfully, refresh scheduled for:', new Date(expiresAt - REFRESH_BUFFER_MS).toISOString());
  } catch (error) {
    logger.error('[TokenManager] Error setting tokens:', error);
    throw error;
  }
}

/**
 * Clear Tokens
 * Removes all tokens from SecureStorage and memory
 */
export async function clearTokens(): Promise<void> {
  try {
    logger.debug('[TokenManager] Clearing tokens');
    
    // CRITICAL: Cancel refresh timer first
    clearRefreshTimer();
    
    // Clear in-memory state
    currentAccessToken = null;
    tokenExpiresAt = null;
    
    // Clear from SecureStorage on iOS
    if (isNativeiOS()) {
      logger.debug('[TokenManager] Removing refresh token from SecureStorage');
      
      try {
        await SecureStorage.remove(REFRESH_TOKEN_KEY);
        logger.debug('[TokenManager] Refresh token removed from SecureStorage');
      } catch {
        // Ignore errors if key doesn't exist
        logger.debug('[TokenManager] Refresh token not found in SecureStorage (may already be cleared)');
      }
    }
    
    // Notify listeners
    notifyListeners(null);
    
    // Mark tokens as ready (cleared state is also a "ready" state)
    markTokensReady();
    
    logger.debug('[TokenManager] Tokens cleared successfully');
  } catch (error) {
    logger.error('[TokenManager] Error clearing tokens:', error);
    throw error;
  }
}

/**
 * On Access Token Change
 * Registers a callback to be notified when the access token changes
 * Returns an unsubscribe function
 */
export function onAccessTokenChange(callback: (token: string | null) => void): () => void {
  logger.debug('[TokenManager] Registering token change listener');
  
  listeners.add(callback);
  
  // Immediately call with current token
  callback(currentAccessToken);
  
  // Return unsubscribe function
  return () => {
    logger.debug('[TokenManager] Unregistering token change listener');
    listeners.delete(callback);
  };
}

/**
 * Get Current Access Token
 * Returns the current access token from memory (does not check expiration)
 */
export function getCurrentAccessToken(): string | null {
  // Keep the paired in-memory expiry state available alongside the token.
  // Expiration is intentionally not enforced by this accessor.
  void tokenExpiresAt;
  return currentAccessToken;
}

/**
 * Perform Refresh
 * Internal function to perform the actual token refresh
 * CRITICAL: Differentiates between auth failures and network/transient errors
 * Only clears tokens on definitive auth failures (401/403)
 */
async function performRefresh(): Promise<string | null> {
  try {
    logger.debug('[TokenManager] Performing token refresh');
    
    // Only refresh on iOS native platform
    if (!isNativeiOS()) {
      logger.debug('[TokenManager] Not iOS native, skipping refresh (web uses session cookies)');
      return null;
    }
    
    // Load refresh token from storage
    const result = await SecureStorage.get(REFRESH_TOKEN_KEY);
    
    if (!result || typeof result !== 'string') {
      logger.warn('[TokenManager] No refresh token available');
      
      toast({
        title: 'Session Expired',
        description: 'Please log in again to continue.',
        variant: 'destructive',
      });
      
      await clearTokens();
      return null;
    }
    
    const tokenData = JSON.parse(result) as TokenData;
    
    if (!tokenData.refreshToken) {
      logger.warn('[TokenManager] No refresh token in stored data');
      
      toast({
        title: 'Session Expired',
        description: 'Please log in again to continue.',
        variant: 'destructive',
      });
      
      await clearTokens();
      return null;
    }
    
    // Validate deviceId is present (required by server)
    if (!tokenData.deviceId) {
      logger.error('[TokenManager] No deviceId in stored data - cannot refresh token');
      
      toast({
        title: 'Session Expired',
        description: 'Please log in again to continue.',
        variant: 'destructive',
      });
      
      await clearTokens();
      return null;
    }
    
    logger.debug('[TokenManager] Calling /api/auth/refresh endpoint', { deviceId: tokenData.deviceId });
    
    // Call refresh endpoint with deviceId (required by server)
    const response = await fetch(`${config.apiBaseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Platform': 'ios-native'
      },
      body: JSON.stringify({
        refreshToken: tokenData.refreshToken,
        deviceId: tokenData.deviceId
      }),
      credentials: 'include'
    });
    
    // CRITICAL: Differentiate error types
    if (response.status === 401 || response.status === 403) {
      // DEFINITIVE AUTH FAILURE: Clear tokens and logout
      logger.error('[TokenManager] Refresh token is invalid or expired (401/403)');
      
      toast({
        title: 'Session Expired',
        description: 'Please log in again to continue.',
        variant: 'destructive',
      });
      
      await clearTokens();
      return null;
    }
    
    if (!response.ok) {
      // TRANSIENT ERROR (network, 500, etc.): Don't clear tokens, allow retry
      logger.error('[TokenManager] Token refresh failed (transient error):', response.status);
      
      toast({
        title: 'Connection Error',
        description: 'Unable to refresh session. Will retry automatically.',
        variant: 'destructive',
      });
      
      // Schedule retry in 30 seconds
      retryTimer = setTimeout(() => {
        logger.debug('[TokenManager] Retrying token refresh after transient error');
        refreshAccessToken();
      }, 30000);
      
      // DON'T clear tokens - user stays authenticated
      return null;
    }
    
    // SUCCESS: Process new tokens
    const newTokenData = await response.json();
    
    if (!newTokenData.accessToken || !newTokenData.refreshToken) {
      logger.error('[TokenManager] Invalid refresh response:', newTokenData);
      return null;
    }
    
    // Store new tokens (preserve deviceId from original token data)
    const decoded = decodeJWT(newTokenData.accessToken);
    const expiresAt = decoded.exp ? decoded.exp * 1000 : Date.now() + 15 * 60 * 1000;
    
    await setTokens({
      accessToken: newTokenData.accessToken,
      refreshToken: newTokenData.refreshToken,
      deviceId: tokenData.deviceId, // Preserve deviceId for future refreshes
      expiresAt,
    });
    
    logger.debug('[TokenManager] Token refresh successful, expires at:', new Date(expiresAt).toISOString());
    
    // Return new access token
    return newTokenData.accessToken;
    
  } catch (error) {
    // NETWORK ERROR (fetch failed, offline, etc.): Don't clear tokens
    logger.error('[TokenManager] Token refresh network error:', error);
    
    toast({
      title: 'Connection Error',
      description: 'Unable to reach server. Will retry when online.',
      variant: 'destructive',
    });
    
    // Schedule retry in 30 seconds
    retryTimer = setTimeout(() => {
      logger.debug('[TokenManager] Retrying token refresh after network error');
      refreshAccessToken();
    }, 30000);
    
    // DON'T clear tokens - user stays authenticated
    return null;
  }
}

/**
 * Check if a refresh is currently in progress
 * Callers can use this to determine if they should wait before retrying
 */
export function isRefreshInProgress(): boolean {
  return refreshLock || isRefreshing;
}

/**
 * Wait for any in-progress refresh to complete
 * Returns the new access token if refresh succeeds, null otherwise
 * CRITICAL: This is the main entry point for callers to get the latest token after a 401
 * CRITICAL: After waiting, callers MUST re-read the token via getCurrentAccessToken()
 */
export async function waitForRefreshComplete(): Promise<string | null> {
  // Check synchronous lock flag
  if (refreshLock && refreshDeferred) {
    logger.debug('[TokenManager] Refresh locked, waiting for existing refresh to complete');
    await refreshDeferred;
    // CRITICAL: After refresh completes, return the fresh token from memory
    // This ensures all callers get the same, most recent token
    const freshToken = getCurrentAccessToken();
    logger.debug('[TokenManager] Refresh complete, returning fresh token from memory');
    return freshToken;
  }
  // No refresh in progress, return current token
  return getCurrentAccessToken();
}

/**
 * Refresh Access Token
 * Refreshes the access token using the refresh token
 * Uses SYNCHRONOUS lock pattern to prevent concurrent refresh attempts
 * CRITICAL: Lock is set BEFORE any async work to prevent race conditions
 * CRITICAL: Promise is ALWAYS resolved in finally block to prevent deadlocks
 */
export async function refreshAccessToken(): Promise<string | null> {
  // CRITICAL: Check synchronous lock FIRST - this prevents the race condition
  // where multiple callers pass the check before any sets the promise
  if (refreshLock && refreshDeferred) {
    logger.debug('[TokenManager] Refresh already locked, waiting for existing refresh');
    await refreshDeferred;
    // After existing refresh completes, return the FRESH token from memory
    const freshToken = getCurrentAccessToken();
    logger.debug('[TokenManager] Existing refresh completed, returning fresh token from memory');
    return freshToken;
  }
  
  // CRITICAL: Set lock SYNCHRONOUSLY before ANY async work
  // This ensures no other caller can pass the check above
  refreshLock = true;
  isRefreshing = true;  // Legacy flag for backwards compatibility
  
  logger.debug('[TokenManager] Acquired refresh lock, starting token refresh');
  
  // Create shared promise for other callers to wait on
  // Track result for finally block resolution
  let refreshResult: string | null = null;
  
  refreshDeferred = new Promise<string | null>((resolve) => {
    resolveRefresh = resolve;
  });
  
  try {
    refreshResult = await performRefresh();
    return refreshResult;
  } catch (error) {
    logger.error('[TokenManager] Token refresh error:', error);
    refreshResult = null;
    return null;
  } finally {
    // CRITICAL: ALWAYS resolve the shared promise in finally block
    // This prevents deadlock if any code path doesn't reach resolution
    if (resolveRefresh) {
      resolveRefresh(refreshResult);
      logger.debug('[TokenManager] Resolved shared refresh promise');
    }
    
    // Clear the refresh state AFTER resolving
    refreshLock = false;
    isRefreshing = false;
    refreshDeferred = null;
    resolveRefresh = null;
    logger.debug('[TokenManager] Released refresh lock');
  }
}

/**
 * Initialize Token Manager
 * Called on app startup to load existing tokens
 */
export async function initializeTokenManager(): Promise<void> {
  logger.debug('[TokenManager] Initializing token manager');
  
  try {
    const tokens = await loadTokens();
    
    if (tokens) {
      logger.debug('[TokenManager] Tokens loaded on initialization');
      
      // Check if token needs immediate refresh
      const now = Date.now();
      if (tokens.expiresAt <= now + REFRESH_BUFFER_MS) {
        logger.debug('[TokenManager] Token expired or expiring soon, refreshing immediately');
        await refreshAccessToken();
      }
    } else {
      logger.debug('[TokenManager] No tokens found on initialization');
    }
  } catch (error) {
    logger.error('[TokenManager] Error initializing token manager:', error);
  }
}

// Log when module is loaded
logger.debug('[TokenManager] Module loaded');
