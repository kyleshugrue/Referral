import { useState, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Device } from '@capacitor/device';
import { logger } from '@/lib/logger';

declare global {
  interface Window {
    Capacitor?: {
      Plugins?: Record<string, unknown>;
      getPlatform?: () => string;
    };
  }
}

/**
 * Helper function to detect if Capacitor bridge is present
 * This is a reliable native-only indicator that works even when standard detection fails
 * Web browsers will never have the Capacitor bridge loaded
 */
function isCapacitorBridgePresent(): boolean {
  try {
    // Check if Capacitor object exists and has expected structure
    const hasCapacitor = typeof window.Capacitor !== 'undefined';
    const hasPlugins = typeof window.Capacitor?.Plugins !== 'undefined';
    const hasPlatformMethod = typeof window.Capacitor?.getPlatform === 'function';
    
    return hasCapacitor && hasPlugins && hasPlatformMethod;
  } catch (error) {
    logger.error('[Platform Detection] Error checking Capacitor bridge:', error);
    return false;
  }
}

/**
 * Hardened native iOS detection for push notifications
 * This function provides more robust detection than basic Capacitor checks,
 * especially important for TestFlight builds where basic detection might fail
 */
function isNativeIOS(): boolean {
  try {
    // Basic Capacitor platform checks
    const isNative = Capacitor.isNativePlatform();
    const isIOS = Capacitor.getPlatform() === 'ios';
    
    // Check if push notification plugins are available (indicates native environment)
    const isFirebaseAvailable = Capacitor.isPluginAvailable('FirebaseMessaging');
    const isPushAvailable = Capacitor.isPluginAvailable('PushNotifications');
    
    // TestFlight-specific fallback: Check for Capacitor bridge presence
    const hasBridge = isCapacitorBridgePresent();
    
    // Log detailed platform detection for debugging
    logger.debug('[Platform Detection] Native iOS detection results', {
      isNative,
      isIOS,
      isFirebaseAvailable,
      isPushAvailable,
      hasBridge,
    });
    
    // Enhanced detection logic with TestFlight fallback
    // Must be iOS platform AND have at least one indicator of native environment
    const result = isIOS && (
      isNative ||           // Standard Capacitor detection
      isFirebaseAvailable || // Firebase plugin available
      isPushAvailable ||     // Push notifications plugin available  
      hasBridge             // Capacitor bridge present (TestFlight fallback)
    );
    
    // Log final result with reasoning
    if (result) {
      const reasons = [
        isNative && 'standard detection',
        isFirebaseAvailable && 'Firebase plugin',
        isPushAvailable && 'Push plugin',
        hasBridge && 'Capacitor bridge'
      ].filter(Boolean);
      logger.debug('[Platform Detection] Native iOS detected', { reasons });
    } else {
      logger.debug('[Platform Detection] Native iOS not detected');
    }
    
    return result;
  } catch (error) {
    logger.error('[Platform Detection] Error in isNativeIOS:', error);
    return false;
  }
}

interface PushNotificationHookReturn {
  isInitialized: boolean;
  hasPermission: boolean | null;
  initializePushNotifications: () => Promise<boolean>;
  checkPermissionStatus: () => Promise<boolean | null>;
  shouldShowRegistrationPopup: () => boolean;
  markRegistrationPopupShown: () => void;
  updateBadgeCount: () => Promise<void>;
}

type PushRetryHelpers = {
  requestPermissionWithRetry: (maxAttempts?: number) => Promise<{ success: boolean; permission?: string }>;
  getTokenWithRetry: (maxAttempts?: number) => Promise<{ success: boolean; token?: string }>;
  registerTokenWithRetry: (token: string, maxAttempts?: number) => Promise<{ success: boolean }>;
};

export function usePushNotifications(): PushNotificationHookReturn {
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const retryHelpersRef = useRef<PushRetryHelpers | null>(null);

  // Check if this is the first visit after registration completion
  const shouldShowRegistrationPopup = useCallback((): boolean => {
    // Only for iOS native platform
    if (!isNativeIOS()) {
      return false;
    }

    // Check if registration was completed
    const registrationComplete = localStorage.getItem('registrationComplete') === 'true';
    
    // Check if we've already shown the popup after registration
    const popupShown = localStorage.getItem('pushNotificationPopupShown') === 'true';
    
    return registrationComplete && !popupShown;
  }, []);

  // Mark that we've shown the popup
  const markRegistrationPopupShown = useCallback((): void => {
    localStorage.setItem('pushNotificationPopupShown', 'true');
  }, []);

  const initializePushNotifications = useCallback(async (): Promise<boolean> => {
    // Only run on iOS native platform (NOT iOS web browsers)
    if (!isNativeIOS()) {
      logger.debug('[Push Notifications] Not iOS native platform; skipping initialization');
      return false;
    }

    const retryHelpers = retryHelpersRef.current;
    if (!retryHelpers) {
      logger.error('[Push Notifications] Retry helpers are not ready');
      return false;
    }

    // Don't initialize twice
    if (isInitialized) {
      logger.debug('[Push Notifications] Already initialized; checking token registration');
      
      // Even if initialized, try to re-register token on app launch
      if (hasPermission) {
        logger.debug('[Push Notifications] Permission already granted; attempting token registration');
        const tokenResult = await retryHelpers.getTokenWithRetry();
        if (tokenResult.success && tokenResult.token) {
          logger.debug('[Push Notifications] Re-registering FCM token on app launch');
          await retryHelpers.registerTokenWithRetry(tokenResult.token);
        }
      }
      
      return hasPermission === true;
    }

    try {
      logger.debug('[Push Notifications] Starting FCM initialization for iOS native', {
        isSecureContext: window.isSecureContext,
      });

      // Check existing permissions first
      const currentPermission = await FirebaseMessaging.checkPermissions();
      logger.debug('[Push Notifications] Current permission status:', currentPermission.receive);

      let permissionResult;
      
      if (currentPermission.receive === 'granted') {
        logger.debug('[Push Notifications] Permission already granted; skipping request');
        permissionResult = { success: true, permission: 'granted' };
      } else {
        logger.debug('[Push Notifications] Requesting permissions');
         permissionResult = await retryHelpers.requestPermissionWithRetry();
      }
      
      if (permissionResult.success && permissionResult.permission === 'granted') {
        logger.info('[Push Notifications] FCM permission granted');
        setHasPermission(true);
        
        // Enhanced token retrieval with retry logic
         const tokenResult = await retryHelpers.getTokenWithRetry();
        
        if (tokenResult.success && tokenResult.token) {
          logger.debug('[Push Notifications] FCM token received successfully');
          
          // Register token with backend using retry logic
           const registrationResult = await retryHelpers.registerTokenWithRetry(tokenResult.token);
          
          if (registrationResult.success) {
            logger.info('[Push Notifications] FCM token registered with backend successfully');
          } else {
            logger.error('[Push Notifications] Failed to register FCM token with backend after retries');
          }
        } else {
          logger.error('[Push Notifications] Failed to get FCM token after retries');
          setHasPermission(false);
          setIsInitialized(true);
          return false;
        }
        
        setIsInitialized(true);
      } else {
        logger.warn('[Push Notifications] FCM permission denied or failed:', permissionResult.permission);
        setHasPermission(false);
        setIsInitialized(true);
        return false;
      }

      // Handle notifications received while app is open
      await FirebaseMessaging.addListener('notificationReceived', (notification) => {
        const notificationData = notification?.notification?.data as { type?: string } | undefined;
        logger.debug('[Push Notifications] FCM notification received while app open', { type: notificationData?.type ?? 'unknown' });
        
        // You could show an in-app notification here
        // For now, we'll let iOS handle it with the system notification
      });

      // Handle notification actions when user taps notification
      await FirebaseMessaging.addListener('notificationActionPerformed', (notification) => {
        // Handle navigation based on notification type.
        // Intentionally not logged: this payload can carry another user's
        // name and a private message preview (see server/services/push-notifications.ts).
        const data = notification?.notification?.data as { type?: string } | undefined;

        if (data && data.type) {
          switch (data.type) {
            case 'connection_request':
              // Navigate to connection requests
              window.location.href = '/connections?tab=requests';
              break;
            case 'connection_accepted':
              // Navigate to connections
              window.location.href = '/connections';
              break;
            case 'new_message':
              // Navigate to messages
              window.location.href = '/connections?tab=messages';
              break;
            default:
              logger.warn('[Push Notifications] Unknown notification type:', data.type);
          }
        }
      });

      // Handle token refresh/rotation events
      await FirebaseMessaging.addListener('tokenReceived', async (event) => {
        logger.debug('[Push Notifications] FCM token refresh received', { hasToken: !!event?.token });
        
        if (event.token) {
          logger.debug('[Push Notifications] Re-registering refreshed token with backend');
           const registrationResult = await retryHelpers.registerTokenWithRetry(event.token);
          
          if (registrationResult.success) {
            logger.info('[Push Notifications] Refreshed token re-registered successfully');
          } else {
            logger.error('[Push Notifications] Failed to re-register refreshed token');
          }
        }
      });

      return true;

    } catch (error) {
      logger.error('[Push Notifications] FCM initialization error:', error);
      setHasPermission(false);
      setIsInitialized(true);
      return false;
    }
  }, [isInitialized, hasPermission]);

  // Helper function for permission request with retry logic
  const requestPermissionWithRetry = useCallback(async (maxAttempts = 3): Promise<{success: boolean, permission?: string}> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.debug(`[Push Notifications] Permission request attempt ${attempt}/${maxAttempts}`);
        const permissionStatus = await FirebaseMessaging.requestPermissions();
        
        logger.debug('[Push Notifications] Permission status:', permissionStatus.receive);
        
        if (permissionStatus.receive === 'granted') {
          return { success: true, permission: 'granted' };
        } else if (permissionStatus.receive === 'denied') {
          return { success: false, permission: 'denied' };
        } else if (permissionStatus.receive === 'prompt' && attempt < maxAttempts) {
          // Wait before retry for 'prompt' status
          logger.debug('[Push Notifications] Permission status is prompt; retrying');
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        
        return { success: false, permission: permissionStatus.receive };
      } catch (error) {
        logger.error(`[Push Notifications] Permission request attempt ${attempt} failed:`, error);
        if (attempt === maxAttempts) {
          return { success: false };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    return { success: false };
  }, []);

  // Helper function for token retrieval with retry logic
  const getTokenWithRetry = useCallback(async (maxAttempts = 3): Promise<{success: boolean, token?: string}> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.debug(`[Push Notifications] Token retrieval attempt ${attempt}/${maxAttempts}`);
        const result = await FirebaseMessaging.getToken();
        
        if (result.token) {
          logger.debug('[Push Notifications] Token retrieved successfully');
          return { success: true, token: result.token };
        }
        
        if (attempt < maxAttempts) {
          logger.debug('[Push Notifications] No token received; retrying');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        logger.error(`[Push Notifications] Token retrieval attempt ${attempt} failed:`, error);
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    return { success: false };
  }, []);

  // Helper function to get device information
  const getDeviceInfo = useCallback(async (): Promise<{deviceId?: string, deviceModel?: string, osVersion?: string}> => {
    try {
      if (!isNativeIOS()) {
        return {};
      }
      
      const info = await Device.getInfo();
      const id = await Device.getId();
      
      logger.debug('[Push Notifications] Device info retrieved:', {
        deviceModel: info.model,
        osVersion: info.osVersion,
        platform: info.platform
      });
      
      return {
        deviceId: id.identifier,
        deviceModel: info.model,
        osVersion: info.osVersion
      };
    } catch (error) {
      logger.error('[Push Notifications] Error getting device info:', error);
      return {};
    }
  }, []);

  // Helper function for token registration with retry logic
  const registerTokenWithRetry = useCallback(async (token: string, maxAttempts = 3): Promise<{success: boolean}> => {
    // Get device information before registration
    const deviceInfo = await getDeviceInfo();
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.debug(`[Push Notifications] Token registration attempt ${attempt}/${maxAttempts}`);
        logger.debug('[Push Notifications] Token received', { tokenLength: token.length });
        logger.debug('[Push Notifications] Device info:', {
          hasDeviceId: !!deviceInfo.deviceId,
          deviceModel: deviceInfo.deviceModel,
          osVersion: deviceInfo.osVersion,
        });
        logger.debug('[Push Notifications] Registering token with backend', { platform: 'ios-native' });
        
        const response = await fetch('/api/push-notifications/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            deviceToken: token,
            platform: 'ios-native',
            ...deviceInfo // Include device metadata
          }),
        });

        if (response.ok) {
          await response.json();
          logger.info('[Push Notifications] Token registration successful');
          return { success: true };
        } else {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          logger.error(`[Push Notifications] Token registration attempt ${attempt} failed:`, {
            status: response.status,
            error: errorData
          });
          
          if (attempt < maxAttempts) {
            // Exponential backoff: 2s, 4s, 8s
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      } catch (error) {
        logger.error(`[Push Notifications] Token registration attempt ${attempt} network error:`, error);
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    return { success: false };
  }, [getDeviceInfo]);

  retryHelpersRef.current = {
    requestPermissionWithRetry,
    getTokenWithRetry,
    registerTokenWithRetry,
  };

  const checkPermissionStatus = useCallback(async (): Promise<boolean | null> => {
    // Only run on iOS native platform (NOT iOS web browsers)
    if (!isNativeIOS()) {
      logger.debug('[Push Notifications] Not iOS native; returning null permission status');
      return null;
    }

    try {
      const permissionStatus = await FirebaseMessaging.checkPermissions();
      logger.debug('[Push Notifications] Current FCM permission status:', permissionStatus.receive);
      
      const hasActivePermission = permissionStatus.receive === 'granted';
      setHasPermission(hasActivePermission);
      
      return hasActivePermission;
    } catch (error) {
      logger.error('[Push Notifications] Error checking FCM permission status:', error);
      return null;
    }
  }, []);

  /**
   * Update badge count based on current unread notifications
   * Call this when:
   * - App launches or comes to foreground
   * - User marks notifications as read
   * - User views a message/connection/request
   */
  const updateBadgeCount = useCallback(async (): Promise<void> => {
    // Only run on iOS native platform
    if (!isNativeIOS()) {
      logger.debug('[Push Notifications] Not iOS native; skipping badge update');
      return;
    }

    try {
      logger.debug('[Push Notifications] Fetching notification counts to update badge');
      
      // Fetch current unread notification counts from backend
      const response = await fetch('/api/notifications/counts', {
        credentials: 'include'
      });

      if (!response.ok) {
        logger.error('[Push Notifications] Failed to fetch notification counts:', response.status);
        return;
      }

      const counts = await response.json();
      const totalUnread = (counts.messages || 0) + (counts.connectionRequests || 0) + (counts.newConnections || 0);

      logger.debug('[Push Notifications] Updating badge count:', {
        messages: counts.messages,
        connectionRequests: counts.connectionRequests,
        newConnections: counts.newConnections,
        total: totalUnread
      });

      // Clear all delivered notifications from notification center
      await PushNotifications.removeAllDeliveredNotifications();
      logger.debug('[Push Notifications] Cleared delivered notifications from notification center');
      
      // Try to update the app icon badge count
      try {
        // On iOS, we can use local notification badge updates
        // @ts-expect-error Capacitor's TypeScript definitions omit the native badge API.
        if (typeof PushNotifications.setBadgeCount === 'function') {
          // @ts-expect-error Capacitor's TypeScript definitions omit the native badge API.
          await PushNotifications.setBadgeCount({ count: totalUnread });
          logger.debug(`[Push Notifications] Set badge count to ${totalUnread}`);
        } else {
          logger.debug('[Push Notifications] setBadgeCount not available; badge will update on next push notification');
        }
      } catch (badgeError) {
        logger.warn('[Push Notifications] Could not set badge count directly:', badgeError);
        logger.debug('[Push Notifications] Badge will be updated by next push notification');
      }
      
      logger.debug('[Push Notifications] Badge update complete');
    } catch (error) {
      logger.error('[Push Notifications] Error updating badge count:', error);
    }
  }, []);

  return {
    isInitialized,
    hasPermission,
    initializePushNotifications,
    checkPermissionStatus,
    shouldShowRegistrationPopup,
    markRegistrationPopupShown,
    updateBadgeCount,
  };
}