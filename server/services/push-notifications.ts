import * as admin from 'firebase-admin';
import { storage } from '../storage';
import { logger } from '../lib/logger';

interface PushNotificationData {
  userId: number;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Circuit breaker for APNs outage detection
 */
class APNsCircuitBreaker {
  private isOpen = false;
  private failureCount = 0;
  private lastFailureTime: number = 0;
  private readonly FAILURE_THRESHOLD = 5; // Open circuit after 5 consecutive failures
  private readonly FAILURE_WINDOW = 60000; // 60 seconds
  private readonly COOLDOWN_PERIOD = 120000; // 2 minutes
  private circuitOpenedAt: number = 0;

  recordFailure(): void {
    const now = Date.now();
    
    // Reset counter if failures are outside the window
    if (now - this.lastFailureTime > this.FAILURE_WINDOW) {
      this.failureCount = 0;
    }
    
    this.failureCount++;
    this.lastFailureTime = now;
    
    if (this.failureCount >= this.FAILURE_THRESHOLD && !this.isOpen) {
      this.openCircuit();
    }
  }

  recordSuccess(): void {
    // Reset on any success
    this.failureCount = 0;
    this.lastFailureTime = 0;
    
    if (this.isOpen) {
      this.closeCircuit();
    }
  }

  isCircuitOpen(): boolean {
    // Auto-close circuit after cooldown period
    if (this.isOpen && Date.now() - this.circuitOpenedAt > this.COOLDOWN_PERIOD) {
      console.log('[Circuit Breaker] Cooldown period expired, attempting to close circuit');
      this.isOpen = false;
      this.failureCount = 0;
    }
    
    return this.isOpen;
  }

  private openCircuit(): void {
    this.isOpen = true;
    this.circuitOpenedAt = Date.now();
    console.warn(`[Circuit Breaker] ⚠️ APNs circuit OPENED after ${this.failureCount} consecutive failures. Queuing notifications for ${this.COOLDOWN_PERIOD / 1000}s`);
  }

  private closeCircuit(): void {
    this.isOpen = false;
    this.failureCount = 0;
    this.circuitOpenedAt = 0;
    console.log('[Circuit Breaker] ✅ APNs circuit CLOSED. Service restored');
  }

  getStatus(): { isOpen: boolean; failureCount: number; openedAt: number } {
    return {
      isOpen: this.isOpen,
      failureCount: this.failureCount,
      openedAt: this.circuitOpenedAt
    };
  }
}

const apnsCircuitBreaker = new APNsCircuitBreaker();

/**
 * Classify FCM error codes as transient (retryable) or permanent
 * Based on official Firebase documentation: https://firebase.google.com/docs/cloud-messaging/error-codes
 */
function isTransientError(errorCode: string): boolean {
  const transientErrors = [
    // Server/infrastructure errors (retry with backoff)
    'messaging/internal-error',
    'messaging/server-unavailable',
    'messaging/unknown-error',
    'messaging/unavailable',
    
    // Rate limiting errors (retry with backoff)
    'messaging/quota-exceeded',
    'messaging/device-message-rate-exceeded',
    'messaging/message-rate-exceeded',
    'messaging/topics-message-rate-exceeded',
    
    // Authentication errors (could be temporary)
    'messaging/authentication-error',
    'messaging/third-party-auth-error'
  ];
  return transientErrors.includes(errorCode);
}

/**
 * Check if error is a token error (token should be removed)
 * CRITICAL: Only token-specific errors should trigger deletion
 */
function isTokenError(errorCode: string): boolean {
  const tokenErrors = [
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered'
  ];
  return tokenErrors.includes(errorCode);
}

/**
 * Check if error is a code/configuration error (non-retryable but DON'T delete token)
 * These indicate bugs in the payload or app configuration, not token problems
 */
function isCodeConfigError(errorCode: string): boolean {
  const codeConfigErrors = [
    // Configuration errors (setup/credential issues)
    'messaging/mismatched-credential',
    'messaging/invalid-apns-credentials',
    'messaging/invalid-package-name',
    
    // Payload errors (code bugs - bad message structure)
    'messaging/invalid-argument',
    'messaging/invalid-recipient',
    'messaging/invalid-data-payload-key',
    'messaging/payload-size-limit-exceeded',
    'messaging/invalid-apns-priority',
    'messaging/too-many-topics'
  ];
  return codeConfigErrors.includes(errorCode);
}

/**
 * Check if error indicates service outage (circuit breaker trigger)
 */
function isServiceOutageError(errorCode: string): boolean {
  return errorCode === 'messaging/server-unavailable' || 
         errorCode === 'messaging/unavailable' ||
         errorCode === 'messaging/unknown-error' ||
         errorCode === 'messaging/internal-error';
}

/**
 * Exponential backoff with jitter
 */
function calculateBackoff(attempt: number, baseDelay: number = 1000): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  return Math.min(exponentialDelay + jitter, 5000); // Cap at 5 seconds
}

/**
 * Determine notification priority for queueing
 */
function getNotificationPriority(data: PushNotificationData): 'critical' | 'standard' {
  const type = data.data?.type || '';
  const criticalTypes = ['connection_request', 'connection_accepted', 'new_message'];
  return criticalTypes.includes(type) ? 'critical' : 'standard';
}

/**
 * Calculate expiration time based on priority
 */
function calculateExpirationTime(priority: 'critical' | 'standard'): string {
  const now = new Date();
  const hoursToAdd = priority === 'critical' ? 24 : 6; // 24h for critical, 6h for standard
  now.setHours(now.getHours() + hoursToAdd);
  return now.toISOString();
}

/**
 * Queue notification for later delivery when APNs is down
 */
async function queueNotification(data: PushNotificationData): Promise<void> {
  try {
    const priority = getNotificationPriority(data);
    const expiresAt = calculateExpirationTime(priority);
    const payload = JSON.stringify(data);
    
    await storage.enqueuePushNotification(data.userId, payload, priority, expiresAt);
    console.log(`[Push Queue] ✉️ Queued ${priority} priority notification for user ${data.userId} (expires: ${expiresAt})`);
  } catch (error) {
    console.error('[Push Queue] Error queueing notification:', error);
  }
}

/**
 * Register a device token for push notifications (iOS native only)
 */
export async function registerDeviceToken(
  userId: number, 
  deviceToken: string, 
  platform: string,
  deviceId?: string,
  deviceModel?: string,
  osVersion?: string
): Promise<boolean> {
  // Only register iOS native device tokens
  if (platform !== 'ios-native') {
    console.log(`[Push Notifications] Ignoring device token registration for platform: ${platform}`);
    return false;
  }

  try {
    const deviceInfo = deviceId ? ` (Device: ${deviceModel}, iOS ${osVersion})` : '';
    console.log(`[Push Notifications] Registering device token for user ${userId} on platform ${platform}${deviceInfo}`);
    await storage.storeFcmToken(userId, deviceToken, platform, deviceId, deviceModel, osVersion);
    console.log(`[Push Notifications] Successfully registered device token for iOS user ${userId}${deviceInfo}`);
    return true;
  } catch (error) {
    console.error('[Push Notifications] Error registering device token:', error);
    return false;
  }
}

/**
 * Get badge count for a user (total unread notifications)
 */
async function getBadgeCount(userId: number): Promise<number> {
  try {
    const timestamp = new Date().toISOString();
    const counts = await storage.getUnreadNotificationCounts(userId);
    const total = counts.messages + counts.connectionRequests + counts.newConnections;
    console.log(`[${timestamp}] [Push Notifications] 📊 Badge count for user ${userId}: ${total} (messages: ${counts.messages}, requests: ${counts.connectionRequests}, connections: ${counts.newConnections})`);
    
    if (total === 0) {
      console.log(`[${timestamp}] [Push Notifications] ⚠️ Badge count is 0 - notification may not have been created yet or user has no unread items`);
    }
    
    return total;
  } catch (error) {
    console.error('[Push Notifications] Error getting badge count:', error);
    return 0;
  }
}

/**
 * Send push notification to iOS native users only with retry logic and circuit breaker
 */
export async function sendPushNotification(data: PushNotificationData): Promise<boolean> {
  const MAX_ATTEMPTS = 3;
  let overallSuccessCount = 0;
  let serviceOutageDetected = false;
  
  try {
    logger.debug(`[Push Notifications] Attempting to send notification to user ${data.userId}`, {
      notificationType: data.data?.type,
      hasCustomData: !!data.data
    });
    
    // Check circuit breaker - queue if open
    if (apnsCircuitBreaker.isCircuitOpen()) {
      console.warn(`[Push Notifications] ⚠️ Circuit is OPEN - queueing notification instead of sending`);
      await queueNotification(data);
      return false; // Return false since notification wasn't sent immediately
    }
    
    // Only get iOS native tokens
    let deviceTokens = await storage.getFcmTokensByUserId(data.userId, 'ios-native');
    
    if (!deviceTokens || deviceTokens.length === 0) {
      console.log(`[Push Notifications] No iOS native device tokens found for user ${data.userId}`);
      return false;
    }

    console.log(`[Push Notifications] Found ${deviceTokens.length} iOS native device token(s) for user ${data.userId}`);

    // Check if Firebase Admin is initialized
    if (!admin.apps.length) {
      console.log('[Push Notifications] Firebase Admin not initialized, cannot send push notifications');
      return false;
    }

    // Get current badge count for this user
    const badgeCount = await getBadgeCount(data.userId);

    // Retry loop for transient failures
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (deviceTokens.length === 0) {
        console.log(`[Push Notifications] No tokens to retry for attempt ${attempt}`);
        break;
      }

      console.log(`[Push Notifications] Attempt ${attempt}/${MAX_ATTEMPTS}: Sending to ${deviceTokens.length} token(s)`);

      // Create a copy of tokens array to prevent mutation issues
      const tokensToSend = [...deviceTokens];

      // Prepare the message with iOS-specific APNs configuration
      const message = {
        notification: {
          title: data.title,
          body: data.body,
        },
        apns: {
          headers: {
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'apns-topic': 'com.professionalnetwork.app',
          },
          payload: {
            aps: {
              alert: {
                title: data.title,
                body: data.body,
              },
              badge: badgeCount,
              sound: 'default',
              'content-available': 1,
            },
            ...(data.data || {})
          },
        },
        tokens: tokensToSend
      };

      if (attempt === 1) {
        logger.debug('[Push Notifications] Message payload prepared', {
          hasNotification: !!message.notification,
          badge: message.apns.payload.aps.badge,
          customDataKeys: data.data ? Object.keys(data.data) : [],
          notificationType: data.data?.type
        });
      }

      // Send the message
      const response = await admin.messaging().sendEachForMulticast(message);
      
      console.log(`[Push Notifications] Attempt ${attempt} result:`, {
        successCount: response.successCount,
        failureCount: response.failureCount
      });

      overallSuccessCount += response.successCount;

      // Process failures: classify errors and prepare for retry
      const permanentFailureTokens: string[] = [];
      const transientFailureTokens: string[] = [];
      const successfulTokens: string[] = [];
      let outageErrorCount = 0;
      
      // Track both successes and failures
      response.responses.forEach((resp, idx) => {
        const token = tokensToSend[idx];
        
        if (resp.success) {
          // Track successful tokens for lastUsed update
          successfulTokens.push(token);
        } else if (resp.error) {
          const errorCode = resp.error.code;
          const errorMessage = resp.error.message;
          
          console.error(`[Push Notifications] Attempt ${attempt} - Token ${idx} failed:`, {
            errorCode,
            errorMessage,
            tokenLength: token.length
          });
          
          // Track service outage indicators
          if (isServiceOutageError(errorCode)) {
            outageErrorCount++;
            serviceOutageDetected = true;
          }
          
          // Classify error using comprehensive FCM error code taxonomy
          if (isTokenError(errorCode)) {
            // Token-specific error - DELETE token immediately
            permanentFailureTokens.push(token);
            console.log(`[Push Notifications] Token error (${errorCode}) - will delete token of length ${token.length}`);
          } else if (isCodeConfigError(errorCode)) {
            // Code/configuration error - DON'T retry, DON'T delete token, LOG for debugging
            console.error(`[Push Notifications] 🚨 CODE/CONFIG ERROR (${errorCode}) - payload or setup issue, NOT a token problem!`, {
              errorCode,
              errorMessage,
              userId: data.userId
            });
            // Don't retry (treat as permanent) but DON'T delete token
            // Add to permanent list to stop retries, but skip deletion step for these
          } else if (isTransientError(errorCode)) {
            // Transient error - retry with backoff
            transientFailureTokens.push(token);
            console.log(`[Push Notifications] Transient failure (${errorCode}) - will retry token of length ${token.length}`);
          } else {
            // Unknown/undocumented error - log extensively but don't delete token (could be new FCM error)
            console.error(`[Push Notifications] ⚠️ UNKNOWN ERROR (${errorCode}) - not deleting token, please investigate:`, {
              errorCode,
              errorMessage,
              userId: data.userId,
              tokenLength: token.length
            });
            // Don't retry unknown errors to avoid infinite loops
          }
        }
      });

      // Update lastUsed for successful tokens
      if (successfulTokens.length > 0) {
        console.log(`[Push Notifications] Updating lastUsed for ${successfulTokens.length} successful token(s)`);
        for (const token of successfulTokens) {
          try {
            await storage.updateFcmTokenLastUsed(token);
          } catch (error) {
            console.error(`[Push Notifications] Error updating lastUsed for token:`, error);
            // Don't fail the send if timestamp update fails
          }
        }
      }

      // Detect widespread service outage (majority of tokens failing with outage errors)
      if (response.failureCount > 0 && outageErrorCount > tokensToSend.length / 2) {
        console.warn(`[Push Notifications] ⚠️ Service outage detected: ${outageErrorCount}/${tokensToSend.length} tokens failed with outage errors`);
        apnsCircuitBreaker.recordFailure();
        
        // If circuit just opened, queue this notification
        if (apnsCircuitBreaker.isCircuitOpen()) {
          console.warn(`[Push Notifications] Circuit opened mid-send - queueing notification`);
          await queueNotification(data);
          return false;
        }
      }

      // Remove permanent failures immediately
      if (permanentFailureTokens.length > 0) {
        console.log(`[Push Notifications] Removing ${permanentFailureTokens.length} permanently failed token(s)`);
        for (const token of permanentFailureTokens) {
          await storage.deleteFcmToken(token);
        }
      }

      // Record success if any tokens succeeded
      if (response.successCount > 0 && !serviceOutageDetected) {
        apnsCircuitBreaker.recordSuccess();
      }

      // If all succeeded or no transient failures, we're done
      if (transientFailureTokens.length === 0) {
        if (overallSuccessCount > 0) {
          console.log(`[Push Notifications] Successfully sent ${overallSuccessCount} notification(s) to user ${data.userId}`);
        }
        return overallSuccessCount > 0;
      }

      // Prepare for retry with only transient failure tokens
      deviceTokens = transientFailureTokens;
      
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = calculateBackoff(attempt);
        console.log(`[Push Notifications] Retrying ${transientFailureTokens.length} transient failure(s) after ${Math.round(backoffMs)}ms backoff`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } else {
        console.warn(`[Push Notifications] Max retries (${MAX_ATTEMPTS}) reached. ${transientFailureTokens.length} token(s) still failing`);
      }
    }

    return overallSuccessCount > 0;
  } catch (error) {
    console.error('[Push Notifications] Error sending push notification:', error);
    return overallSuccessCount > 0;
  }
}

/**
 * Send connection request notification (iOS native only)
 */
export async function sendConnectionRequestNotification(userId: number, senderName: string): Promise<boolean> {
  return sendPushNotification({
    userId,
    title: 'New Connection Request',
    body: `${senderName} wants to connect with you`,
    data: {
      type: 'connection_request',
      sender_name: senderName  // Changed to snake_case for iOS compatibility
    }
  });
}

/**
 * Send connection accepted notification (iOS native only)
 */
export async function sendConnectionAcceptedNotification(userId: number, accepterName: string): Promise<boolean> {
  return sendPushNotification({
    userId,
    title: 'Connection Accepted',
    body: `${accepterName} accepted your connection request`,
    data: {
      type: 'connection_accepted',
      accepter_name: accepterName  // Changed to snake_case for iOS compatibility
    }
  });
}

/**
 * Send new message notification (iOS native only)
 */
export async function sendNewMessageNotification(userId: number, senderName: string, messagePreview: string): Promise<boolean> {
  // Truncate message preview to reasonable length
  const preview = messagePreview.length > 50 ? messagePreview.substring(0, 50) + '...' : messagePreview;
  
  return sendPushNotification({
    userId,
    title: `Message from ${senderName}`,
    body: preview,
    data: {
      type: 'new_message',
      sender_name: senderName,  // Changed to snake_case for iOS compatibility
      message_preview: preview  // Added message_preview field for iOS
    }
  });
}

/**
 * Process queued push notifications (to be called by background job)
 */
export async function processQueuedPushNotifications(): Promise<void> {
  try {
    // Skip if circuit is still open
    if (apnsCircuitBreaker.isCircuitOpen()) {
      console.log('[Push Queue] Circuit is open, skipping queue processing');
      return;
    }
    
    // Get pending notifications (max 20 per batch)
    const notifications = await storage.getPendingQueuedNotifications(20);
    
    if (notifications.length === 0) {
      return;
    }
    
    console.log(`[Push Queue] Processing ${notifications.length} queued notification(s)`);
    
    for (const queued of notifications) {
      try {
        // Mark as processing
        await storage.updateQueuedNotificationStatus(queued.id, 'processing');
        await storage.incrementQueuedNotificationAttempts(queued.id);
        
        // Parse payload
        const data: PushNotificationData = JSON.parse(queued.payload);
        
        // Try to send
        const success = await sendPushNotification(data);
        
        if (success) {
          // Mark as completed
          await storage.updateQueuedNotificationStatus(queued.id, 'completed');
          console.log(`[Push Queue] ✅ Successfully processed queued notification ${queued.id}`);
        } else {
          // Check if max attempts reached
          if (queued.attemptCount >= 9) {
            await storage.updateQueuedNotificationStatus(queued.id, 'failed', 'Max attempts reached');
            console.warn(`[Push Queue] ❌ Failed queued notification ${queued.id} after ${queued.attemptCount} attempts`);
          } else {
            // Return to pending for retry
            await storage.updateQueuedNotificationStatus(queued.id, 'pending');
            console.log(`[Push Queue] Queued notification ${queued.id} returned to pending (attempt ${queued.attemptCount})`);
          }
        }
      } catch (error) {
        console.error(`[Push Queue] Error processing queued notification ${queued.id}:`, error);
        await storage.updateQueuedNotificationStatus(
          queued.id, 
          'failed', 
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
    
    // Clean up expired/completed notifications
    const deletedCount = await storage.deleteExpiredQueuedNotifications();
    if (deletedCount > 0) {
      console.log(`[Push Queue] Cleaned up ${deletedCount} expired/completed notification(s)`);
    }
  } catch (error) {
    console.error('[Push Queue] Error in queue processor:', error);
  }
}

/**
 * Remove device token for a user
 */
export async function removeDeviceToken(userId: number, deviceToken: string): Promise<boolean> {
  try {
    console.log(`[Push Notifications] Removing device token for user ${userId}`);
    await storage.deleteFcmToken(deviceToken);
    console.log(`[Push Notifications] Successfully removed device token for user ${userId}`);
    return true;
  } catch (error) {
    console.error('[Push Notifications] Error removing device token:', error);
    return false;
  }
}