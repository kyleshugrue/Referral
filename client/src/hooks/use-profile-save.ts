import { useCallback, useRef, useState, useEffect } from "react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { config } from "@/lib/config";
import { getCurrentAccessToken, refreshAccessToken, waitForTokensReady } from "@/lib/token-manager";
import { Capacitor } from "@capacitor/core";
import { iosProfileSaveManager } from "@/lib/ios-profile-save-manager";
import type { User } from "@shared/schema";

/**
 * iOS Native Platform Detection
 * Returns true if running on native iOS Capacitor
 */
function isNativeiOS(): boolean {
  return Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
}

/**
 * Convert relative URLs to absolute URLs for iOS native platform
 * On iOS native, relative URLs go to capacitor://localhost which doesn't work
 */
function getAbsoluteUrl(url: string): string {
  if (!isNativeiOS()) {
    return url; // Web platform uses relative URLs normally
  }
  
  // If URL is already absolute, return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // For iOS native, prepend the API base URL
  const normalizedUrl = url.startsWith('/') ? url : `/${url}`;
  const absoluteUrl = `${config.apiBaseUrl}${normalizedUrl}`;
  
  console.log(`[useProfileSave] iOS native: Converted "${url}" to "${absoluteUrl}"`);
  return absoluteUrl;
}

/**
 * Build headers for iOS native platform with JWT authentication
 * For web platform, returns minimal headers (uses session cookies)
 */
async function buildIOSNativeHeaders(baseHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...baseHeaders };
  
  if (isNativeiOS()) {
    // Wait for token initialization to complete
    await waitForTokensReady();
    
    // Add platform identification headers
    headers['X-Platform'] = 'ios-native';
    headers['X-Capacitor-Platform'] = 'ios';
    
    // Add JWT authentication
    const accessToken = getCurrentAccessToken();
    if (accessToken && accessToken !== 'PENDING_REFRESH') {
      headers['Authorization'] = `Bearer ${accessToken}`;
      console.log('[useProfileSave] iOS native: Using JWT token for authentication');
    } else {
      console.warn('[useProfileSave] iOS native: No JWT token available for authentication');
    }
  }
  
  return headers;
}

/**
 * Handle 401 response on iOS native by refreshing token and returning new headers
 * Returns null if refresh fails (caller should handle auth error)
 */
async function handleIOSNative401(currentHeaders: Record<string, string>): Promise<Record<string, string> | null> {
  if (!isNativeiOS()) {
    return null; // Web platform doesn't use JWT refresh
  }
  
  console.log('[useProfileSave] iOS native: Got 401, attempting token refresh');
  
  const newAccessToken = await refreshAccessToken();
  
  if (newAccessToken) {
    console.log('[useProfileSave] iOS native: Token refreshed successfully');
    return {
      ...currentHeaders,
      'Authorization': `Bearer ${newAccessToken}`
    };
  }
  
  console.error('[useProfileSave] iOS native: Token refresh failed');
  return null;
}

type SaveStatus = 'idle' | 'pending' | 'saving' | 'retrying' | 'saved' | 'error';

type PartialProfile = Partial<Omit<User, 'id' | 'password'>>;

interface UseProfileSaveOptions {
  /** Debounce delay for text field changes (default: 300ms for desktop, 500ms for mobile) */
  debounceDelay?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
}

interface UseProfileSaveResult {
  /** Debounced save - queues data for saving after debounce delay */
  saveProfile: (data: PartialProfile) => void;
  /** Immediate save - bypasses debounce, used for explicit save button clicks */
  flushPendingSave: (data?: PartialProfile) => Promise<{ success: boolean; savedData: User | null }>;
  /** Upload and save photo - handles file upload then saves URL to profile */
  uploadPhoto: (file: File) => Promise<{ success: boolean; savedData: User | null }>;
  /** Delete photo - removes photo from profile */
  deletePhoto: () => Promise<{ success: boolean; savedData: User | null }>;
  /** Upload and save resume - handles file upload then saves URL to profile */
  uploadResume: (file: File) => Promise<{ success: boolean; savedData: User | null }>;
  /** Delete resume and its preview references through the dedicated media route */
  deleteResume: () => Promise<{ success: boolean; savedData: User | null }>;
  /** Current save status for UI feedback */
  saveStatus: SaveStatus;
  /** Current retry attempt count */
  retryCount: number;
  /** Cancel pending saves and rollback optimistic updates */
  cancelPendingSave: () => void;
  /** Last successfully saved user data from server */
  lastSavedData: User | null;
  /** Check if there are unsaved changes by comparing form data to cache */
  hasUnsavedChanges: (formData: PartialProfile) => boolean;
  /** Get the current cached user data (source of truth) */
  getCachedUser: () => User | null;
  /** Timestamp of the last successful save (to prevent form reset race conditions) */
  lastSaveTimestamp: number;
  /** Current save operation version (incremented on each save start, used to prevent form reset during save cycle) */
  saveOperationVersion: number;
  /** Check if form reset should be blocked (returns true if save is in progress or recently completed) */
  shouldBlockFormReset: () => boolean;
}

/** Generate a unique operation ID for tracing */
function generateOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

const DEFAULT_DEBOUNCE_DELAY = 300;
const MOBILE_DEBOUNCE_DELAY = 500;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];
const SAVED_STATUS_DURATION = 2000;
/** 
 * PRODUCTION-GRADE: Extended window to block form resets after save 
 * This must be long enough to cover:
 * - Network latency
 * - Server processing
 * - React Query cache update
 * - React re-render cycle
 * - Any debounced effects
 * - The saved→idle status transition (SAVED_STATUS_DURATION = 2000ms)
 * 
 * Set to 5000ms to ensure complete coverage of all async operations
 */
const FORM_RESET_BLOCK_WINDOW = 5000;

/**
 * Additional grace period after a save operation completes
 * This covers the case where cache updates trigger after the save
 */
const POST_SAVE_GRACE_PERIOD = 2000;

function isRetryableError(status: number): boolean {
  return status === 0 || status === 503 || status >= 500;
}

function isClientError(status: number): boolean {
  return status >= 400 && status < 500;
}

/**
 * Normalize values for comparison - treats null, undefined, "" as equivalent
 * for strings, and [], null, undefined as equivalent for arrays
 * Also handles numeric 0 specially (not treated as empty)
 */
function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length === 0 ? null : value;
  }
  // Treat 0 as a valid value (not equivalent to null)
  if (typeof value === 'number') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return value;
}

/**
 * Deep compare two objects with normalization for profile data
 */
function isProfileEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  const allKeys = new Set([...keysA, ...keysB]);
  
  for (const key of allKeys) {
    const valA = normalizeValue(a[key]);
    const valB = normalizeValue(b[key]);
    
    // Handle array comparison
    if (Array.isArray(valA) && Array.isArray(valB)) {
      if (valA.length !== valB.length) return false;
      for (let i = 0; i < valA.length; i++) {
        if (valA[i] !== valB[i]) return false;
      }
      continue;
    }
    
    if (valA !== valB) return false;
  }
  
  return true;
}

/**
 * Detect if running on mobile device for debounce timing
 */
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function useProfileSave(options: UseProfileSaveOptions = {}): UseProfileSaveResult {
  const { toast } = useToast();
  
  const debounceDelay = options.debounceDelay ?? (isMobileDevice() ? MOBILE_DEBOUNCE_DELAY : DEFAULT_DEBOUNCE_DELAY);
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [retryCount, setRetryCount] = useState(0);
  const [lastSavedData, setLastSavedData] = useState<User | null>(null);
  const [lastSaveTimestamp, setLastSaveTimestamp] = useState<number>(0);
  const [saveOperationVersion, setSaveOperationVersion] = useState<number>(0);
  
  // Refs for stable values across renders
  const saveStatusRef = useRef<SaveStatus>('idle');
  const lastSavedDataRef = useRef<User | null>(null);
  const lastSaveTimestampRef = useRef<number>(0);
  const saveOperationVersionRef = useRef<number>(0);
  const currentOperationIdRef = useRef<string | null>(null);
  
  // PRODUCTION-GRADE: Track the save operation end time (when saved→idle transition completes)
  // This is separate from lastSaveTimestamp to handle the full async cycle
  const saveOperationEndTimeRef = useRef<number>(0);
  
  // PRODUCTION-GRADE: Active save generation sentinel
  // This tracks whether ANY save operation is active (including cache reconciliation)
  // It's only set to false when both the network request completes AND the cache is reconciled
  const activeSaveGenerationRef = useRef<number>(0);
  const lastCompletedGenerationRef = useRef<number>(0);
  
  // Timing and request management refs
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<PartialProfile | null>(null);
  const isInFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const previousCacheRef = useRef<User | null>(null);
  const inFlightPromiseRef = useRef<Promise<{ success: boolean; savedData: User | null }> | null>(null);

  // Sync status to ref for use in async operations
  const updateSaveStatus = useCallback((status: SaveStatus) => {
    saveStatusRef.current = status;
    if (isMountedRef.current) {
      setSaveStatus(status);
    }
  }, []);

  const updateLastSavedData = useCallback((data: User | null) => {
    lastSavedDataRef.current = data;
    if (isMountedRef.current) {
      setLastSavedData(data);
    }
  }, []);

  // Cleanup on unmount
  // iOS NATIVE FIX: Don't abort requests on iOS - the singleton manager handles saves
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (savedStatusTimerRef.current) {
        clearTimeout(savedStatusTimerRef.current);
      }
      // iOS NATIVE FIX: Don't abort in-flight requests on iOS native
      // The singleton manager will complete the save even after component unmount
      if (abortControllerRef.current && !isNativeiOS()) {
        abortControllerRef.current.abort();
      }
    };
  }, []);
  
  // iOS NATIVE: Subscribe to singleton manager status updates
  useEffect(() => {
    if (!isNativeiOS()) return;
    
    const unsubscribe = iosProfileSaveManager.addStatusListener((status) => {
      console.log('[useProfileSave] iOS singleton status update:', status);
      
      if (isMountedRef.current) {
        // Map iOS manager status to hook status
        if (status === 'saved') {
          updateSaveStatus('saved');
          const savedData = iosProfileSaveManager.getLastSavedData();
          if (savedData) {
            updateLastSavedData(savedData);
            lastSaveTimestampRef.current = iosProfileSaveManager.getLastSaveTimestamp();
            setLastSaveTimestamp(lastSaveTimestampRef.current);
          }
        } else if (status === 'error') {
          updateSaveStatus('error');
        } else if (status === 'saving') {
          updateSaveStatus('saving');
        } else if (status === 'retrying') {
          updateSaveStatus('retrying');
        } else {
          updateSaveStatus('idle');
        }
      }
    });
    
    return unsubscribe;
  }, [updateSaveStatus, updateLastSavedData]);

  const clearSavedStatusTimer = useCallback(() => {
    if (savedStatusTimerRef.current) {
      clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = null;
    }
  }, []);

  /**
   * Schedule the saved→idle transition
   * @param generationToComplete - The specific generation this save belongs to
   */
  const scheduleSavedStatusClear = useCallback((generationToComplete: number) => {
    clearSavedStatusTimer();
    savedStatusTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        // PRODUCTION-GRADE: Track when the save operation fully ends (saved→idle)
        saveOperationEndTimeRef.current = Date.now();
        
        // CRITICAL FIX: Only mark THIS generation as completed
        // If a new save started after this one, don't mark anything newer as complete
        if (generationToComplete > lastCompletedGenerationRef.current) {
          lastCompletedGenerationRef.current = generationToComplete;
          console.log(`[useProfileSave] Save generation ${generationToComplete} completed, active: ${activeSaveGenerationRef.current}`);
        }
        
        // Only transition to idle if no newer generation is active
        if (activeSaveGenerationRef.current === generationToComplete) {
          updateSaveStatus('idle');
          console.log(`[useProfileSave] Transitioned to idle, grace period until ${saveOperationEndTimeRef.current + POST_SAVE_GRACE_PERIOD}`);
        } else {
          console.log(`[useProfileSave] Skipping idle transition, newer generation ${activeSaveGenerationRef.current} is active`);
        }
      }
    }, SAVED_STATUS_DURATION);
  }, [clearSavedStatusTimer, updateSaveStatus]);

  const rollbackCache = useCallback(() => {
    if (previousCacheRef.current) {
      queryClient.setQueryData(["/api/user"], previousCacheRef.current);
      previousCacheRef.current = null;
    }
  }, []);

  /**
   * Get the current cached user data - this is the single source of truth
   */
  const getCachedUser = useCallback((): User | null => {
    return queryClient.getQueryData<User>(["/api/user"]) ?? null;
  }, []);

  /**
   * Check if form data has unsaved changes compared to cache
   */
  const hasUnsavedChanges = useCallback((formData: PartialProfile): boolean => {
    const cachedUser = getCachedUser();
    if (!cachedUser) {
      console.log("[useProfileSave] hasUnsavedChanges: no cached user, returning false");
      return false;
    }
    
    // Compare all fields in formData against cache, treating missing cache values as null/undefined
    // This ensures we detect changes to fields that might not be in the cached record yet
    const formKeys = Object.keys(formData);
    const cacheSubset: Record<string, unknown> = {};
    const formSubset: Record<string, unknown> = {};
    
    for (const key of formKeys) {
      // Get cache value (will be undefined if key doesn't exist in cache)
      cacheSubset[key] = (cachedUser as Record<string, unknown>)[key];
      formSubset[key] = (formData as Record<string, unknown>)[key];
    }
    
    const isEqual = isProfileEqual(formSubset, cacheSubset);
    
    // Debug logging for change detection
    if (!isEqual) {
      console.log("[useProfileSave] hasUnsavedChanges: changes detected", {
        formKeys,
        differences: formKeys.filter(key => {
          const formVal = normalizeValue(formSubset[key]);
          const cacheVal = normalizeValue(cacheSubset[key]);
          return formVal !== cacheVal && !(Array.isArray(formVal) && Array.isArray(cacheVal) && 
            formVal.length === cacheVal.length && formVal.every((v, i) => v === cacheVal[i]));
        })
      });
    }
    
    return !isEqual;
  }, [getCachedUser]);

  /**
   * PRODUCTION-GRADE: Check if form reset should be blocked
   * This is the authoritative method to determine if the form should NOT be reset
   * 
   * Uses a multi-layer defense:
   * 1. Active save generation sentinel - blocks until save + cache reconciliation complete
   * 2. Status checks - blocks during any active save status
   * 3. Time-based windows - blocks within time windows after save operations
   * 4. In-flight request check - blocks while network request is active
   * 5. iOS singleton manager state - blocks while iOS background save is in progress
   * 
   * The form reset guard only drops when ALL conditions are clear.
   */
  const shouldBlockFormReset = useCallback((): boolean => {
    const now = Date.now();
    const status = saveStatusRef.current;
    const timeSinceLastSave = now - lastSaveTimestampRef.current;
    const timeSinceOperationEnd = now - saveOperationEndTimeRef.current;
    const isWithinBlockWindow = lastSaveTimestampRef.current > 0 && timeSinceLastSave < FORM_RESET_BLOCK_WINDOW;
    const isWithinGracePeriod = saveOperationEndTimeRef.current > 0 && timeSinceOperationEnd < POST_SAVE_GRACE_PERIOD;
    const isInFlight = isInFlightRef.current;
    
    // PRODUCTION-GRADE: Check if there's an active save generation that hasn't completed
    // This is the most reliable check - it stays true until the save fully completes
    const hasUncompletedGeneration = activeSaveGenerationRef.current > lastCompletedGenerationRef.current;
    
    // iOS NATIVE FIX: Also check if the iOS singleton manager has an operation in progress
    const iosOperationInProgress = isNativeiOS() && iosProfileSaveManager.isOperationInProgress();
    
    // Block if ANY of these conditions are true:
    // 1. There's an uncompleted save generation (network + cache reconciliation not done)
    // 2. Save is actively in progress (saving, retrying, pending, saved)
    // 3. Within the main block window after a save started
    // 4. Within the grace period after save completed (saved→idle transition)
    // 5. Request is in flight
    // 6. iOS singleton manager has an operation in progress
    const shouldBlock = 
      hasUncompletedGeneration ||
      iosOperationInProgress ||
      status === 'saving' || 
      status === 'retrying' || 
      status === 'pending' ||
      status === 'saved' ||
      isWithinBlockWindow ||
      isWithinGracePeriod ||
      isInFlight;
    
    console.log("[useProfileSave] shouldBlockFormReset:", shouldBlock, {
      hasUncompletedGeneration,
      iosOperationInProgress,
      activeGeneration: activeSaveGenerationRef.current,
      lastCompletedGeneration: lastCompletedGenerationRef.current,
      status,
      timeSinceLastSave: lastSaveTimestampRef.current > 0 ? timeSinceLastSave : 'N/A',
      timeSinceOperationEnd: saveOperationEndTimeRef.current > 0 ? timeSinceOperationEnd : 'N/A',
      isWithinBlockWindow,
      isWithinGracePeriod,
      isInFlight,
    });
    
    return shouldBlock;
  }, []);

  /**
   * Core save operation with retry logic and optimistic updates
   * PRODUCTION-GRADE: Includes operation ID tracing for debugging
   */
  const performSave = useCallback(async (
    data: PartialProfile,
    attempt: number = 0,
    operationId?: string,
    generationForThisOp?: number
  ): Promise<{ success: boolean; savedData: User | null }> => {
    // Generate operation ID on first attempt for end-to-end tracing
    const opId = operationId || generateOperationId();
    
    // PRODUCTION-GRADE: Capture generation at save start as immutable local variable
    // This ensures the correct generation is used throughout the entire save lifecycle
    let thisOpGeneration = generationForThisOp;
    
    if (attempt === 0) {
      currentOperationIdRef.current = opId;
      // Increment save operation version to signal a new save cycle
      const newVersion = saveOperationVersionRef.current + 1;
      saveOperationVersionRef.current = newVersion;
      setSaveOperationVersion(newVersion);
      
      // PRODUCTION-GRADE: Increment the active save generation and capture it
      activeSaveGenerationRef.current = activeSaveGenerationRef.current + 1;
      thisOpGeneration = activeSaveGenerationRef.current;
      
      console.log(`[useProfileSave][${opId}] 🚀 NEW SAVE OPERATION started, version: ${newVersion}, generation: ${thisOpGeneration}`);
    }
    
    console.log(`[useProfileSave][${opId}] performSave called with data:`, data ? Object.keys(data) : "none", "attempt:", attempt);
    
    if (!isMountedRef.current) {
      console.log(`[useProfileSave][${opId}] performSave: component not mounted, aborting`);
      return { success: false, savedData: null };
    }

    // PRODUCTION-GRADE: Clean data before sending to server
    // 1. Remove undefined values
    // 2. Remove empty strings for enum fields (server validation rejects empty strings for enums)
    // 3. Convert empty strings to null for fields that accept null but not empty string
    const enumFields = ['educationLevel', 'industry', 'genderIdentity', 'pronouns'];
    const cleanedData = Object.fromEntries(
      Object.entries(data)
        .filter(([key, v]) => {
          // Remove undefined values
          if (v === undefined) return false;
          // Remove empty strings for enum fields (these would fail server validation)
          if (enumFields.includes(key) && v === '') return false;
          return true;
        })
    );

    console.log(`[useProfileSave][${opId}] performSave cleanedData keys:`, Object.keys(cleanedData));

    if (Object.keys(cleanedData).length === 0) {
      console.log(`[useProfileSave][${opId}] performSave: no data after cleaning, returning idle`);
      updateSaveStatus('idle');
      return { success: true, savedData: lastSavedDataRef.current };
    }

    isInFlightRef.current = true;
    
    // CRITICAL: Set save status BEFORE optimistic update
    // This prevents the form reset effect from running when the cache update triggers a re-render
    // The effect checks saveStatus and skips reset when status is 'saving' or 'retrying'
    if (attempt === 0) {
      updateSaveStatus('saving');
      setRetryCount(0);
    } else {
      updateSaveStatus('retrying');
      setRetryCount(attempt);
    }

    // First attempt: setup optimistic update
    if (attempt === 0) {
      // Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      
      // Store current cache for rollback
      const currentCache = getCachedUser();
      previousCacheRef.current = currentCache ? { ...currentCache } : null;

      // Apply optimistic update (status is already 'saving' so form reset effect will skip)
      if (currentCache) {
        console.log(`[useProfileSave][${opId}] Applying optimistic update to cache`);
        queryClient.setQueryData(["/api/user"], {
          ...currentCache,
          ...cleanedData
        });
      }
    }

    abortControllerRef.current = new AbortController();

    try {
      console.log(`[useProfileSave][${opId}] Making PATCH request to /api/user with data:`, JSON.stringify(cleanedData));
      console.log(`[useProfileSave][${opId}] Including X-Operation-ID header for server-side tracing`);
      
      // iOS NATIVE FIX: Use absolute URL and JWT authentication for iOS native platform
      const requestUrl = getAbsoluteUrl('/api/user');
      const baseHeaders = {
        'Content-Type': 'application/json',
        'X-Operation-ID': opId,
      };
      const requestHeaders = await buildIOSNativeHeaders(baseHeaders);
      
      console.log(`[useProfileSave][${opId}] Request URL: ${requestUrl}, isIOSNative: ${isNativeiOS()}`);
      
      let response = await fetch(requestUrl, {
        method: 'PATCH',
        headers: requestHeaders,
        body: JSON.stringify(cleanedData),
        credentials: 'include',
        signal: abortControllerRef.current.signal,
      });

      console.log(`[useProfileSave][${opId}] PATCH response status:`, response.status);

      // iOS NATIVE FIX: Handle 401 with token refresh and retry
      if (response.status === 401 && isNativeiOS()) {
        console.log(`[useProfileSave][${opId}] iOS native: Got 401, attempting token refresh and retry`);
        const refreshedHeaders = await handleIOSNative401(requestHeaders);
        
        if (refreshedHeaders) {
          // Retry with refreshed token
          response = await fetch(requestUrl, {
            method: 'PATCH',
            headers: refreshedHeaders,
            body: JSON.stringify(cleanedData),
            credentials: 'include',
            signal: abortControllerRef.current.signal,
          });
          console.log(`[useProfileSave][${opId}] iOS native: Retry response status:`, response.status);
        }
      }

      if (!isMountedRef.current) return { success: false, savedData: null };

      if (!response.ok) {
        const status = response.status;

        // Validation errors - don't retry
        if (status === 422) {
          let errorMessage = 'Validation error';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
           } catch {
             // The response may not contain JSON; retain the validation fallback.
           }
          
          rollbackCache();
          isInFlightRef.current = false;
          updateSaveStatus('error');
          
          toast({
            title: "Validation Error",
            description: errorMessage,
            variant: "destructive",
          });
          return { success: false, savedData: null };
        }

        // Authentication errors - special handling with clear message
        if (status === 401 || status === 403) {
          console.error("[useProfileSave] 🚨 AUTHENTICATION ERROR:", status, "- User session may have expired");
          let errorMessage = 'Your session has expired. Please refresh the page and try again.';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
           } catch {
             // The response may not contain JSON; retain the session-expired fallback.
           }
          
          rollbackCache();
          isInFlightRef.current = false;
          updateSaveStatus('error');
          
          toast({
            title: "Session Expired",
            description: errorMessage,
            variant: "destructive",
            duration: 5000,
          });
          return { success: false, savedData: null };
        }

        // Client errors - don't retry
        if (isClientError(status)) {
          console.error("[useProfileSave] Client error:", status);
          let errorMessage = 'Failed to save profile';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
           } catch {
             // The response may not contain JSON; retain the generic client-error fallback.
           }
          
          rollbackCache();
          isInFlightRef.current = false;
          updateSaveStatus('error');
          
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
          return { success: false, savedData: null };
        }

        // Server errors - retry with exponential backoff
        if (isRetryableError(status) && attempt < maxRetries) {
          console.log(`[useProfileSave][${opId}] Server error ${status}, retrying in ${RETRY_DELAYS[attempt]}ms`);
          const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
          await new Promise(resolve => setTimeout(resolve, delay));
          
          if (isMountedRef.current) {
            return performSave(data, attempt + 1, opId, thisOpGeneration);
          }
          return { success: false, savedData: null };
        }

        // Max retries exceeded
        rollbackCache();
        isInFlightRef.current = false;
        updateSaveStatus('error');
        
        toast({
          title: "Failed to save",
          description: "Please try again later.",
          variant: "destructive",
        });
        return { success: false, savedData: null };
      }

      // Success - update cache with server response
      const responseData = await response.json() as User;
      console.log(`[useProfileSave][${opId}] ✅ SAVE SUCCESS - updating cache with server response`);

      if (!isMountedRef.current) return { success: false, savedData: null };

      // Update React Query cache with authoritative server data
      queryClient.setQueryData(["/api/user"], responseData);
      previousCacheRef.current = null;
      updateLastSavedData(responseData);
      
      // Update last save timestamp to prevent form reset race conditions
      // This allows consuming components to know when a save just completed
      const now = Date.now();
      lastSaveTimestampRef.current = now;
      setLastSaveTimestamp(now);
      console.log(`[useProfileSave][${opId}] Set lastSaveTimestamp: ${now}, form reset blocked for ${FORM_RESET_BLOCK_WINDOW}ms`);

      isInFlightRef.current = false;
      updateSaveStatus('saved');
      setRetryCount(0);
      
      toast({
        title: "Saved",
        description: "Your profile has been updated.",
        duration: 2000,
      });

      // PRODUCTION-GRADE: Pass the generation this save belongs to (captured at start)
      // This ensures only THIS generation gets marked complete when the timer fires
      scheduleSavedStatusClear(thisOpGeneration!);

      // Process any pending data that accumulated during save
      if (pendingDataRef.current) {
        const nextData = pendingDataRef.current;
        pendingDataRef.current = null;
        console.log(`[useProfileSave][${opId}] Processing pending data accumulated during save`);
        return performSave(nextData);
      }

      console.log(`[useProfileSave][${opId}] 🎉 SAVE OPERATION COMPLETE`);
      return { success: true, savedData: responseData };

    } catch (error) {
      if (!isMountedRef.current) return { success: false, savedData: null };

      // Aborted requests are not errors
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, savedData: null };
      }

      // Network errors - retry
      if (attempt < maxRetries) {
        console.log(`[useProfileSave][${opId}] Network error, retrying in ${RETRY_DELAYS[attempt]}ms`);
        const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
        await new Promise(resolve => setTimeout(resolve, delay));
        
        if (isMountedRef.current) {
          return performSave(data, attempt + 1, opId, thisOpGeneration);
        }
        return { success: false, savedData: null };
      }

      rollbackCache();
      isInFlightRef.current = false;
      updateSaveStatus('error');
      
      toast({
        title: "Network Error",
        description: "Please check your connection and try again.",
        variant: "destructive",
      });
      return { success: false, savedData: null };
    }
  }, [toast, rollbackCache, scheduleSavedStatusClear, updateSaveStatus, updateLastSavedData, getCachedUser, maxRetries]);

  /**
   * Debounced save - accumulates changes and saves after delay
   * iOS NATIVE FIX: Uses singleton manager that persists beyond component lifecycle
   */
  const saveProfile = useCallback((data: PartialProfile) => {
    // Clear any existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    clearSavedStatusTimer();
    
    // Set status to pending to indicate changes are queued
    updateSaveStatus('pending');

    // Accumulate data
    if (isInFlightRef.current) {
      // Request in flight - queue data for after completion
      pendingDataRef.current = pendingDataRef.current 
        ? { ...pendingDataRef.current, ...data }
        : data;
      return;
    }

    pendingDataRef.current = pendingDataRef.current 
      ? { ...pendingDataRef.current, ...data }
      : data;

    // Schedule save after debounce delay
    debounceTimerRef.current = setTimeout(async () => {
      // iOS NATIVE FIX: Don't check isMountedRef for iOS - singleton handles unmount case
      if (!isNativeiOS() && !isMountedRef.current) return;
      
      const dataToSave = pendingDataRef.current;
      pendingDataRef.current = null;
      
      if (dataToSave) {
        // iOS NATIVE FIX: Use singleton manager for background saves
        if (isNativeiOS()) {
          console.log("[useProfileSave] iOS native: Debounced save via singleton manager");
          activeSaveGenerationRef.current = activeSaveGenerationRef.current + 1;
          updateSaveStatus('saving');
          
          const result = await iosProfileSaveManager.saveProfile(dataToSave);
          
          if (result.success && result.savedData && isMountedRef.current) {
            updateLastSavedData(result.savedData);
            lastSaveTimestampRef.current = Date.now();
            setLastSaveTimestamp(lastSaveTimestampRef.current);
            lastCompletedGenerationRef.current = activeSaveGenerationRef.current;
          }
        } else {
          // Web platform: use original logic
          performSave(dataToSave);
        }
      }
    }, debounceDelay);
  }, [performSave, clearSavedStatusTimer, updateSaveStatus, updateLastSavedData, debounceDelay]);

  /**
   * Immediate save - bypasses debounce, used for explicit save button
   * iOS NATIVE FIX: Uses singleton manager that persists beyond component lifecycle
   */
  const flushPendingSave = useCallback(async (data?: PartialProfile): Promise<{ success: boolean; savedData: User | null }> => {
    console.log("[useProfileSave] flushPendingSave called with data:", data ? Object.keys(data) : "none");
    console.log("[useProfileSave] pendingDataRef.current:", pendingDataRef.current ? Object.keys(pendingDataRef.current) : "none");
    
    // Clear debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    clearSavedStatusTimer();

    // Merge any pending data with provided data
    const dataToSave = data 
      ? (pendingDataRef.current ? { ...pendingDataRef.current, ...data } : data)
      : pendingDataRef.current;

    console.log("[useProfileSave] dataToSave computed:", dataToSave ? Object.keys(dataToSave) : "none");

    if (!dataToSave || Object.keys(dataToSave).length === 0) {
      console.log("[useProfileSave] flushPendingSave: no data to save, returning early");
      return { success: true, savedData: lastSavedDataRef.current };
    }

    pendingDataRef.current = null;

    // iOS NATIVE FIX: Use singleton manager that survives component unmount
    // This ensures saves complete even when user navigates away from profile page
    if (isNativeiOS()) {
      console.log("[useProfileSave] iOS native: Delegating to singleton manager for persistent save");
      
      // Increment save operation version to signal a new save cycle
      const newVersion = saveOperationVersionRef.current + 1;
      saveOperationVersionRef.current = newVersion;
      setSaveOperationVersion(newVersion);
      
      // Increment active save generation
      activeSaveGenerationRef.current = activeSaveGenerationRef.current + 1;
      
      updateSaveStatus('saving');
      
      // Use the singleton manager - it won't be aborted on unmount
      const result = await iosProfileSaveManager.saveProfile(dataToSave);
      
      if (result.success && result.savedData) {
        // Update our local state with the result
        updateLastSavedData(result.savedData);
        lastSaveTimestampRef.current = Date.now();
        setLastSaveTimestamp(lastSaveTimestampRef.current);
        lastCompletedGenerationRef.current = activeSaveGenerationRef.current;
        
        // Show success toast
        toast({
          title: "Saved",
          description: "Your profile has been updated.",
          duration: 2000,
        });
      }
      
      return result;
    }

    // Web platform: use original logic with abort controller
    // If request is in flight, wait for it and then process remaining data
    if (isInFlightRef.current && inFlightPromiseRef.current) {
      pendingDataRef.current = dataToSave;
      
      try {
        const inFlightResult = await inFlightPromiseRef.current;
        
        // Process remaining pending data
        if (pendingDataRef.current) {
          const remainingData = pendingDataRef.current;
          pendingDataRef.current = null;
          return performSave(remainingData);
        }
        
        return inFlightResult;
      } catch (error) {
        console.error("[useProfileSave] flushPendingSave: In-flight request failed:", error);
        return { success: false, savedData: null };
      }
    }

    // Execute save immediately
    inFlightPromiseRef.current = performSave(dataToSave);
    
    try {
      const result = await inFlightPromiseRef.current;
      return result;
    } finally {
      inFlightPromiseRef.current = null;
    }
  }, [performSave, clearSavedStatusTimer, toast, updateSaveStatus, updateLastSavedData]);

  /**
   * Upload photo and save to profile - unified flow
   * iOS NATIVE FIX: Uses absolute URLs and JWT authentication for iOS native platform
   */
  const uploadPhoto = useCallback(async (file: File): Promise<{ success: boolean; savedData: User | null }> => {
    // Validate file
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file (JPG, PNG, etc.)",
        variant: "destructive",
      });
      return { success: false, savedData: null };
    }

    if (file.size > 25 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image smaller than 25MB",
        variant: "destructive",
      });
      return { success: false, savedData: null };
    }

    updateSaveStatus('saving');

    try {
      // Upload the file
      const formData = new FormData();
      formData.append('photo', file);

      // iOS NATIVE FIX: Use absolute URL and JWT authentication
      const requestUrl = getAbsoluteUrl('/api/upload/photo');
      const requestHeaders = await buildIOSNativeHeaders({});
      
      console.log(`[useProfileSave] uploadPhoto: URL=${requestUrl}, isIOSNative=${isNativeiOS()}`);

      let uploadRes = await fetch(requestUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: formData,
        credentials: 'include',
      });

      // iOS NATIVE FIX: Handle 401 with token refresh and retry
      if (uploadRes.status === 401 && isNativeiOS()) {
        console.log('[useProfileSave] uploadPhoto: iOS native got 401, attempting token refresh');
        const refreshedHeaders = await handleIOSNative401(requestHeaders);
        
        if (refreshedHeaders) {
          uploadRes = await fetch(requestUrl, {
            method: 'POST',
            headers: refreshedHeaders,
            body: formData,
            credentials: 'include',
          });
          console.log('[useProfileSave] uploadPhoto: Retry response status:', uploadRes.status);
        }
      }

      if (!uploadRes.ok) {
        throw new Error('Failed to upload photo');
      }

      const data = await uploadRes.json() as { user?: User };
      if (!data.user) {
        throw new Error('Photo upload did not return a saved profile');
      }
      queryClient.setQueryData(["/api/user"], data.user);
      updateLastSavedData(data.user);
      updateSaveStatus('saved');
      return { success: true, savedData: data.user };

    } catch (error) {
      updateSaveStatus('error');
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload photo",
        variant: "destructive",
      });
      return { success: false, savedData: null };
    }
  }, [toast, updateSaveStatus, updateLastSavedData]);

  /**
   * Delete photo from profile - unified flow
   */
  const deletePhoto = useCallback(async (): Promise<{ success: boolean; savedData: User | null }> => {
    updateSaveStatus('saving');
    try {
      const headers = await buildIOSNativeHeaders({});
      let response = await fetch(getAbsoluteUrl('/api/media/photo'), {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });
      if (response.status === 401 && isNativeiOS()) {
        const refreshedHeaders = await handleIOSNative401(headers);
        if (refreshedHeaders) {
          response = await fetch(getAbsoluteUrl('/api/media/photo'), {
            method: 'DELETE',
            headers: refreshedHeaders,
            credentials: 'include',
          });
        }
      }
      if (!response.ok) throw new Error('Failed to remove photo');
      const user = await response.json() as User;
      queryClient.setQueryData(["/api/user"], user);
      updateLastSavedData(user);
      updateSaveStatus('saved');
      return { success: true, savedData: user };
    } catch (error) {
      updateSaveStatus('error');
      toast({
        title: 'Remove failed',
        description: error instanceof Error ? error.message : 'Failed to remove photo',
        variant: 'destructive',
      });
      return { success: false, savedData: null };
    }
  }, [toast, updateSaveStatus, updateLastSavedData]);

  /**
   * Upload resume and save to profile - unified flow
   * iOS NATIVE FIX: Uses absolute URLs and JWT authentication for iOS native platform
   */
  const uploadResume = useCallback(async (file: File): Promise<{ success: boolean; savedData: User | null }> => {
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select a file smaller than 10MB",
        variant: "destructive",
      });
      return { success: false, savedData: null };
    }

    updateSaveStatus('saving');

    try {
      const formData = new FormData();
      formData.append('resume', file);

      // iOS NATIVE FIX: Use absolute URL and JWT authentication
      const requestUrl = getAbsoluteUrl('/api/upload/resume');
      const requestHeaders = await buildIOSNativeHeaders({});
      
      console.log(`[useProfileSave] uploadResume: URL=${requestUrl}, isIOSNative=${isNativeiOS()}`);

      let uploadRes = await fetch(requestUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: formData,
        credentials: 'include',
      });

      // iOS NATIVE FIX: Handle 401 with token refresh and retry
      if (uploadRes.status === 401 && isNativeiOS()) {
        console.log('[useProfileSave] uploadResume: iOS native got 401, attempting token refresh');
        const refreshedHeaders = await handleIOSNative401(requestHeaders);
        
        if (refreshedHeaders) {
          uploadRes = await fetch(requestUrl, {
            method: 'POST',
            headers: refreshedHeaders,
            body: formData,
            credentials: 'include',
          });
          console.log('[useProfileSave] uploadResume: Retry response status:', uploadRes.status);
        }
      }

      if (!uploadRes.ok) {
        throw new Error('Failed to upload resume');
      }

      const data = await uploadRes.json() as { user?: User };
      if (!data.user) {
        throw new Error('Resume upload did not return a saved profile');
      }
      queryClient.setQueryData(["/api/user"], data.user);
      updateLastSavedData(data.user);
      updateSaveStatus('saved');
      return { success: true, savedData: data.user };

    } catch (error) {
      updateSaveStatus('error');
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload resume",
        variant: "destructive",
      });
      return { success: false, savedData: null };
    }
  }, [toast, updateSaveStatus, updateLastSavedData]);

  const deleteResume = useCallback(async (): Promise<{ success: boolean; savedData: User | null }> => {
    updateSaveStatus('saving');
    try {
      const headers = await buildIOSNativeHeaders({});
      let response = await fetch(getAbsoluteUrl('/api/media/resume'), {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });
      if (response.status === 401 && isNativeiOS()) {
        const refreshedHeaders = await handleIOSNative401(headers);
        if (refreshedHeaders) {
          response = await fetch(getAbsoluteUrl('/api/media/resume'), {
            method: 'DELETE',
            headers: refreshedHeaders,
            credentials: 'include',
          });
        }
      }
      if (!response.ok) throw new Error('Failed to remove resume');
      const user = await response.json() as User;
      queryClient.setQueryData(["/api/user"], user);
      updateLastSavedData(user);
      updateSaveStatus('saved');
      return { success: true, savedData: user };
    } catch (error) {
      updateSaveStatus('error');
      toast({
        title: 'Remove failed',
        description: error instanceof Error ? error.message : 'Failed to remove resume',
        variant: 'destructive',
      });
      return { success: false, savedData: null };
    }
  }, [toast, updateSaveStatus, updateLastSavedData]);

  /**
   * Cancel pending saves and rollback optimistic updates
   */
  const cancelPendingSave = useCallback(() => {
    // Clear debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    
    // Clear pending data
    pendingDataRef.current = null;
    
    // Abort in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Rollback optimistic updates
    rollbackCache();
    
    if (isMountedRef.current) {
      updateSaveStatus('idle');
      setRetryCount(0);
    }
  }, [rollbackCache, updateSaveStatus]);

  return {
    saveProfile,
    flushPendingSave,
    uploadPhoto,
    deletePhoto,
    uploadResume,
    deleteResume,
    saveStatus,
    retryCount,
    cancelPendingSave,
    lastSavedData,
    hasUnsavedChanges,
    getCachedUser,
    lastSaveTimestamp,
    saveOperationVersion,
    shouldBlockFormReset,
  };
}
