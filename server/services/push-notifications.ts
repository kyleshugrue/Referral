import * as admin from 'firebase-admin';
import { storage } from '../storage';
import { recordQueueEvent, setQueueDepth } from '../lib/operational-metrics';
import { logger } from '../lib/logger';
import { decideQueueDelivery, type QueueDeliveryOutcome } from './queue-delivery-policy';

interface PushDeliveryResult {
  success: boolean;
  outcome: QueueDeliveryOutcome;
}

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
      logger.info('[Circuit Breaker] Cooldown period expired; attempting to close circuit');
      this.isOpen = false;
      this.failureCount = 0;
    }
    
    return this.isOpen;
  }

  private openCircuit(): void {
    this.isOpen = true;
    this.circuitOpenedAt = Date.now();
    logger.warn('[Circuit Breaker] APNs circuit opened', {
      failureCount: this.failureCount,
      cooldownSeconds: this.COOLDOWN_PERIOD / 1000,
    });
  }

  private closeCircuit(): void {
    this.isOpen = false;
    this.failureCount = 0;
    this.circuitOpenedAt = 0;
    logger.info('[Circuit Breaker] APNs circuit closed; service restored');
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
let pushQueueRunActive = false;

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
  const priority = getNotificationPriority(data);
  const expiresAt = calculateExpirationTime(priority);
  const payload = JSON.stringify(data);
  await storage.enqueuePushNotification(data.userId, payload, priority, expiresAt);
  logger.info('[Push Queue] Notification queued', {
    userId: data.userId,
    priority,
    expiresAt,
    notificationType: data.data?.type,
  });
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
    logger.debug('[Push Notifications] Ignoring unsupported device platform', { platform });
    return false;
  }

  try {
    logger.debug('[Push Notifications] Registering device token', { userId, platform, hasDeviceMetadata: Boolean(deviceId) });
    await storage.storeFcmToken(userId, deviceToken, platform, deviceId, deviceModel, osVersion);
    logger.info('[Push Notifications] Device token registered', { userId, platform });
    return true;
  } catch (error) {
    logger.error('[Push Notifications] Error registering device token', { errorClass: error instanceof Error ? error.name : 'UnknownError' });
    return false;
  }
}

/**
 * Get badge count for a user (total unread notifications)
 */
async function getBadgeCount(userId: number): Promise<number> {
  try {
    const counts = await storage.getUnreadNotificationCounts(userId);
    const total = counts.messages + counts.connectionRequests + counts.newConnections;
    logger.debug('[Push Notifications] Badge count resolved', { userId, total });
    
    if (total === 0) {
      logger.debug('[Push Notifications] Badge count is zero', { userId });
    }
    
    return total;
  } catch (error) {
    logger.error('[Push Notifications] Error getting badge count', { errorClass: error instanceof Error ? error.name : 'UnknownError' });
    return 0;
  }
}

/**
 * Send push notification to iOS native users only with retry logic and circuit breaker
 */
async function sendPushNotificationInternal(
  data: PushNotificationData,
  options: { queueOnFailure: boolean; requestId?: string; returnQueuedAsSuccess?: boolean },
): Promise<PushDeliveryResult> {
  const MAX_ATTEMPTS = 3;
  let overallSuccessCount = 0;
  let serviceOutageDetected = false;
  let retryableFailureDetected = false;
  let permanentFailureDetected = false;
  
  try {
    logger.debug(`[Push Notifications] Attempting to send notification to user ${data.userId}`, {
      notificationType: data.data?.type,
      hasCustomData: !!data.data,
      requestId: options.requestId,
    });
    
    // Check circuit breaker - queue if open
    if (apnsCircuitBreaker.isCircuitOpen()) {
      logger.warn('[Push Notifications] Circuit is open; queueing notification');
      if (options.queueOnFailure) await queueNotification(data);
      return { success: options.returnQueuedAsSuccess === true, outcome: 'retryable-failure' };
    }
    
    // Only get iOS native tokens
    let deviceTokens = await storage.getFcmTokensByUserId(data.userId, 'ios-native');
    
    if (!deviceTokens || deviceTokens.length === 0) {
      logger.debug('[Push Notifications] No native device tokens found', { userId: data.userId });
      return { success: false, outcome: 'permanent-failure' };
    }

    logger.debug('[Push Notifications] Native device tokens found', { userId: data.userId, count: deviceTokens.length });

    // Check if Firebase Admin is initialized
    if (!admin.apps.length) {
      logger.warn('[Push Notifications] Firebase Admin is not initialized');
      if (options.queueOnFailure) await queueNotification(data);
      return { success: options.returnQueuedAsSuccess === true, outcome: 'retryable-failure' };
    }

    // Get current badge count for this user
    const badgeCount = await getBadgeCount(data.userId);

    // Retry loop for transient failures
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (deviceTokens.length === 0) {
        logger.debug('[Push Notifications] No tokens left to retry', { attempt });
        break;
      }

      logger.debug('[Push Notifications] Sending notification attempt', { attempt, maxAttempts: MAX_ATTEMPTS, tokenCount: deviceTokens.length });

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
      
      logger.debug('[Push Notifications] Notification attempt completed', {
        attempt,
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
          
          logger.warn('[Push Notifications] Notification token failed', {
            attempt,
            tokenIndex: idx,
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
            permanentFailureDetected = true;
            logger.info('[Push Notifications] Removing invalid device token', { errorCode, tokenLength: token.length });
          } else if (isCodeConfigError(errorCode)) {
            permanentFailureDetected = true;
            // Code/configuration error - DON'T retry, DON'T delete token, LOG for debugging
            logger.error('[Push Notifications] Provider payload/configuration error', {
              errorCode,
              errorMessage,
              userId: data.userId
            });
            // Don't retry (treat as permanent) but DON'T delete token
            // Add to permanent list to stop retries, but skip deletion step for these
          } else if (isTransientError(errorCode)) {
            // Transient error - retry with backoff
            retryableFailureDetected = true;
            transientFailureTokens.push(token);
            logger.warn('[Push Notifications] Transient provider failure; retrying', { errorCode, tokenLength: token.length });
          } else {
            permanentFailureDetected = true;
            // Unknown/undocumented error - log extensively but don't delete token (could be new FCM error)
            logger.error('[Push Notifications] Unknown provider error; token retained', {
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
        logger.debug('[Push Notifications] Updating successful token timestamps', { count: successfulTokens.length });
        for (const token of successfulTokens) {
          try {
            await storage.updateFcmTokenLastUsed(token);
          } catch (error) {
            logger.warn('[Push Notifications] Error updating token timestamp', { errorClass: error instanceof Error ? error.name : 'UnknownError' });
            // Don't fail the send if timestamp update fails
          }
        }
      }

      // Detect widespread service outage (majority of tokens failing with outage errors)
      if (response.failureCount > 0 && outageErrorCount > tokensToSend.length / 2) {
        logger.warn('[Push Notifications] Provider outage detected', { outageErrorCount, tokenCount: tokensToSend.length });
        apnsCircuitBreaker.recordFailure();
        
        // If circuit just opened, queue this notification
        if (apnsCircuitBreaker.isCircuitOpen()) {
          logger.warn('[Push Notifications] Circuit opened mid-send');
          if (options.queueOnFailure) await queueNotification(data);
          return { success: options.returnQueuedAsSuccess === true, outcome: 'retryable-failure' };
        }
      }

      // Remove permanent failures immediately
      if (permanentFailureTokens.length > 0) {
        logger.info('[Push Notifications] Removing invalid device tokens', { count: permanentFailureTokens.length });
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
          logger.info('[Push Notifications] Notification delivered', { userId: data.userId, deliveryCount: overallSuccessCount });
        }
        return {
          success: overallSuccessCount > 0,
          outcome: overallSuccessCount > 0 ? 'delivered' : 'permanent-failure',
        };
      }

      // Prepare for retry with only transient failure tokens
      deviceTokens = transientFailureTokens;
      
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = calculateBackoff(attempt);
        logger.debug('[Push Notifications] Retrying transient failures', { count: transientFailureTokens.length, backoffMs: Math.round(backoffMs) });
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } else {
        logger.warn('[Push Notifications] Maximum provider retries reached', { maxAttempts: MAX_ATTEMPTS, remaining: transientFailureTokens.length });
      }
    }

    if (overallSuccessCount === 0 && options.queueOnFailure && (serviceOutageDetected || retryableFailureDetected)) {
      await queueNotification(data);
    }
    return {
      success: overallSuccessCount > 0,
      outcome: overallSuccessCount > 0
        ? 'delivered'
        : retryableFailureDetected || serviceOutageDetected
          ? 'retryable-failure'
          : permanentFailureDetected
            ? 'permanent-failure'
            : 'retryable-failure',
    };
  } catch (error) {
    logger.error('[Push Notifications] Error sending push notification', { errorClass: error instanceof Error ? error.name : 'UnknownError' });
    if (options.queueOnFailure) {
      try {
        await queueNotification(data);
      } catch (queueError) {
        logger.error('[Push Notifications] Failed to persist notification fallback', {
          errorClass: queueError instanceof Error ? queueError.name : 'UnknownError',
        });
      }
    }
    return {
      success: overallSuccessCount > 0,
      outcome: overallSuccessCount > 0 ? 'delivered' : 'retryable-failure',
    };
  }
}

export async function sendPushNotification(
  data: PushNotificationData,
  options: { queueOnFailure?: boolean; requestId?: string; returnQueuedAsSuccess?: boolean } = {},
): Promise<boolean> {
  const result = await sendPushNotificationInternal(data, {
    queueOnFailure: options.queueOnFailure !== false,
    requestId: options.requestId,
    returnQueuedAsSuccess: options.returnQueuedAsSuccess,
  });
  return result.success;
}

/**
 * Send connection request notification (iOS native only)
 */
export async function sendConnectionRequestNotification(userId: number, senderName: string, requestId?: string): Promise<boolean> {
  return sendPushNotification({
    userId,
    title: 'New Connection Request',
    body: `${senderName} wants to connect with you`,
    data: {
      type: 'connection_request',
      sender_name: senderName  // Changed to snake_case for iOS compatibility
    }
  }, { requestId, returnQueuedAsSuccess: true });
}

/**
 * Send connection accepted notification (iOS native only)
 */
export async function sendConnectionAcceptedNotification(userId: number, accepterName: string, requestId?: string): Promise<boolean> {
  return sendPushNotification({
    userId,
    title: 'Connection Accepted',
    body: `${accepterName} accepted your connection request`,
    data: {
      type: 'connection_accepted',
      accepter_name: accepterName  // Changed to snake_case for iOS compatibility
    }
  }, { requestId, returnQueuedAsSuccess: true });
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
  if (pushQueueRunActive) {
    logger.debug('[Push Queue] Previous queue run is still active');
    return;
  }
  pushQueueRunActive = true;
  try {
    const initialStats = await storage.getQueuedNotificationStats();
    setQueueDepth('push', initialStats.pending + initialStats.processing);
    // Skip if circuit is still open
    if (apnsCircuitBreaker.isCircuitOpen()) {
      logger.debug('[Push Queue] Circuit is open; skipping queue processing');
      return;
    }
    
    // Claim notifications atomically; this is safe when multiple web processes
    // run the fallback processor concurrently.
    const notifications: Array<{id: number, userId: number, payload: string, priority: string, attemptCount: number}> = [];
    for (let i = 0; i < 20; i++) {
      const notification = await storage.claimPendingQueuedNotification();
      if (!notification) break;
      notifications.push(notification);
      recordQueueEvent('push', 'claimed');
    }
    
    if (notifications.length === 0) {
      return;
    }
    
    logger.debug('[Push Queue] Processing queued notifications', { count: notifications.length });
    
    for (const queued of notifications) {
      try {
        // Parse payload
        const data: PushNotificationData = JSON.parse(queued.payload);
        
        // Try to send
        const result = await sendPushNotificationInternal(data, { queueOnFailure: false });

        if (result.success) {
          // Mark as completed
          await storage.updateQueuedNotificationStatus(queued.id, 'completed');
          recordQueueEvent('push', 'completed');
          logger.info('[Push Queue] Queued notification delivered', { notificationId: queued.id });
        } else {
          // Check if max attempts reached
           const decision = decideQueueDelivery(result.outcome, queued.attemptCount, 10);
          if (decision.status === 'failed') {
            await storage.updateQueuedNotificationStatus(queued.id, decision.status, decision.errorMessage);
            recordQueueEvent('push', 'failed');
            logger.warn('[Push Queue] Queued notification permanently failed', { notificationId: queued.id, attempts: queued.attemptCount });
           } else {
            // Return to pending for retry
            await storage.updateQueuedNotificationStatus(queued.id, 'pending');
            logger.debug('[Push Queue] Queued notification returned to pending', { notificationId: queued.id, attempt: queued.attemptCount });
          }
        }
      } catch (error) {
        logger.error('[Push Queue] Error processing queued notification', { notificationId: queued.id, errorClass: error instanceof Error ? error.name : 'UnknownError' });
        const decision = decideQueueDelivery('retryable-failure', queued.attemptCount, 10);
        await storage.updateQueuedNotificationStatus(queued.id, decision.status, decision.errorMessage);
        recordQueueEvent('push', decision.status === 'failed' ? 'failed' : 'claimed');
      }
    }
    
    // Clean up expired/completed notifications
    const deletedCount = await storage.deleteExpiredQueuedNotifications();
    if (deletedCount > 0) {
      logger.debug('[Push Queue] Cleaned up notifications', { count: deletedCount });
    }
    const finalStats = await storage.getQueuedNotificationStats();
    setQueueDepth('push', finalStats.pending + finalStats.processing);
  } catch (error) {
    logger.error('[Push Queue] Error in queue processor', { errorClass: error instanceof Error ? error.name : 'UnknownError' });
  } finally {
    pushQueueRunActive = false;
  }
}

/**
 * Remove device token for a user
 */
export async function removeDeviceToken(userId: number, deviceToken: string): Promise<boolean> {
  try {
    logger.debug('[Push Notifications] Removing device token', { userId });
    await storage.deleteFcmToken(deviceToken);
    logger.info('[Push Notifications] Device token removed', { userId });
    return true;
  } catch (error) {
    logger.error('[Push Notifications] Error removing device token', { errorClass: error instanceof Error ? error.name : 'UnknownError' });
    return false;
  }
}