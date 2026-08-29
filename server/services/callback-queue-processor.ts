import type { IStorage } from '../storage';
import type { CallbackNotification } from '../../shared/schema';
import { broadcastMatchRefresh } from '../websocket-utils';
import { logger } from '../lib/logger';

type CallbackPayload = Record<string, unknown>;

export class CallbackQueueProcessor {
  private storage: IStorage;
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 30000; // 30 seconds
  private readonly MAX_ATTEMPTS = 3; // Maximum retry attempts per notification

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Start the callback queue processor
   * Polls the queue every 30 seconds and processes pending notifications
   */
  start(): void {
    if (this.isProcessing) {
      logger.debug('[CallbackQueueProcessor] Already running');
      return;
    }

    logger.info('[CallbackQueueProcessor] 🚀 Starting callback queue processor...');
    this.isProcessing = true;

    // Process immediately on start
    this.processQueue().catch(error => {
      logger.error('[CallbackQueueProcessor] Error in initial queue processing:', error);
    });

    // Then process every 30 seconds
    this.processingInterval = setInterval(() => {
      this.processQueue().catch(error => {
        logger.error('[CallbackQueueProcessor] Error in periodic queue processing:', error);
      });
    }, this.POLL_INTERVAL_MS);

    logger.info('[CallbackQueueProcessor] ✅ Callback queue processor started (polling every 30s)');
  }

  /**
   * Stop the callback queue processor
   */
  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.isProcessing = false;
    logger.info('[CallbackQueueProcessor] Callback queue processor stopped');
  }

  /**
   * Process all pending notifications in the queue
   */
  private async processQueue(): Promise<void> {
    try {
      // Get pending notifications sorted by priority and age
      const pendingNotifications = await this.storage.getPendingCallbackNotifications(100);
      
      if (pendingNotifications.length === 0) {
        logger.debug('[CallbackQueueProcessor] No pending notifications to process');
        return;
      }

      logger.info(`[CallbackQueueProcessor] 📬 Processing ${pendingNotifications.length} pending notification(s)`);

      // Process each notification
      const results = await Promise.allSettled(
        pendingNotifications.map(notification => this.processNotification(notification))
      );

      // Count successes and failures
      let successCount = 0;
      let failureCount = 0;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          successCount++;
        } else {
          failureCount++;
        }
      }

      logger.info(`[CallbackQueueProcessor] ✅ Processed ${successCount} notification(s), ${failureCount} failed`);
    } catch (error) {
      logger.error('[CallbackQueueProcessor] Error processing queue:', error);
    }
  }

  /**
   * Process a single notification
   */
  private async processNotification(notification: CallbackNotification): Promise<boolean> {
    const notificationId = notification.id;
    const userId = notification.userId;
    const notificationType = notification.notificationType;

    try {
      // Check if notification is expired
      const now = new Date();
      const expiresAt = new Date(notification.expiresAt);
      if (now > expiresAt) {
        logger.debug(`[CallbackQueueProcessor] Notification ${notificationId} expired, marking as failed`);
        await this.storage.updateCallbackNotification(notificationId, {
          status: 'failed',
          errorMessage: 'Notification expired',
          lastAttemptAt: now.toISOString()
        });
        return false;
      }

      // Parse payload
      let payload: CallbackPayload;
      try {
        const parsedPayload: unknown = JSON.parse(notification.payload);
        if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
          throw new Error('Payload must be a JSON object');
        }
        payload = parsedPayload as CallbackPayload;
      } catch (error) {
        logger.error(`[CallbackQueueProcessor] Invalid JSON payload for notification ${notificationId}:`, error);
        await this.storage.updateCallbackNotification(notificationId, {
          status: 'failed',
          errorMessage: 'Invalid JSON payload',
          lastAttemptAt: now.toISOString()
        });
        return false;
      }

      logger.debug(`[CallbackQueueProcessor] Processing notification ${notificationId} (type: ${notificationType}, user: ${userId})`);

      // Mark as processing
      await this.storage.updateCallbackNotification(notificationId, {
        status: 'processing',
        attemptCount: notification.attemptCount + 1,
        lastAttemptAt: now.toISOString()
      });

      // Handle different notification types
      let success = false;
      switch (notificationType) {
        case 'matchRefresh':
          success = await this.handleMatchRefresh(userId, payload);
          break;
        
        case 'connectionRequest':
          success = await this.handleConnectionRequest(userId, payload);
          break;
        
        case 'connectionAccepted':
          success = await this.handleConnectionAccepted(userId, payload);
          break;
        
        default:
          logger.warn(`[CallbackQueueProcessor] Unknown notification type: ${notificationType}`);
          success = false;
      }

      // Update notification status
      if (success) {
        await this.storage.updateCallbackNotification(notificationId, {
          status: 'completed'
        });
        logger.debug(`[CallbackQueueProcessor] ✅ Successfully processed notification ${notificationId}`);
        return true;
      } else {
        // Check if we should retry
        const attemptCount = notification.attemptCount + 1;
        if (attemptCount >= this.MAX_ATTEMPTS) {
          await this.storage.updateCallbackNotification(notificationId, {
            status: 'failed',
            errorMessage: `Failed after ${attemptCount} attempts`
          });
          logger.warn(`[CallbackQueueProcessor] ❌ Notification ${notificationId} failed after ${attemptCount} attempts`);
        } else {
          // Reset to pending for retry
          await this.storage.updateCallbackNotification(notificationId, {
            status: 'pending'
          });
          logger.debug(`[CallbackQueueProcessor] Notification ${notificationId} will be retried (attempt ${attemptCount}/${this.MAX_ATTEMPTS})`);
        }
        return false;
      }
    } catch (error) {
      logger.error(`[CallbackQueueProcessor] Error processing notification ${notificationId}:`, error);
      
      // Check if we should retry
      const attemptCount = notification.attemptCount + 1;
      if (attemptCount >= this.MAX_ATTEMPTS) {
        await this.storage.updateCallbackNotification(notificationId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } else {
        // Reset to pending for retry
        await this.storage.updateCallbackNotification(notificationId, {
          status: 'pending'
        });
      }
      return false;
    }
  }

  /**
   * Handle match refresh notification
   * CRITICAL: Returns false if user is not connected, enabling retry on next poll
   * This ensures notifications are eventually delivered when user reconnects
   */
  private async handleMatchRefresh(userId: number, payload: CallbackPayload): Promise<boolean> {
    void payload;
    try {
      logger.debug(`[CallbackQueueProcessor] Sending match refresh to user ${userId}`);
      const success = await broadcastMatchRefresh(userId);
      if (success) {
        logger.debug(`[CallbackQueueProcessor] ✅ Match refresh broadcast sent to user ${userId}`);
        return true;
      } else {
        // CRITICAL FIX: Return false when user is offline so notification stays pending
        // This ensures retry on next poll cycle when user might be connected
        logger.debug(`[CallbackQueueProcessor] User ${userId} not connected, will retry on next poll`);
        return false;
      }
    } catch (error) {
      logger.error(`[CallbackQueueProcessor] Error broadcasting match refresh to user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Handle connection request notification
   */
  private async handleConnectionRequest(userId: number, payload: CallbackPayload): Promise<boolean> {
    try {
      const { senderId, requestId } = payload;
      if (!senderId || !requestId) {
        throw new Error('Invalid connection request payload');
      }
      
      logger.debug(`[CallbackQueueProcessor] Sending connection request notification to user ${userId}`);
      // We could implement this using websocket-utils if needed
      // For now, just log success
      logger.debug(`[CallbackQueueProcessor] ✅ Connection request notification processed for user ${userId}`);
      return true;
    } catch (error) {
      logger.error(`[CallbackQueueProcessor] Error handling connection request for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Handle connection accepted notification
   */
  private async handleConnectionAccepted(userId: number, payload: CallbackPayload): Promise<boolean> {
    try {
      const { acceptedById, requestId } = payload;
      if (!acceptedById || !requestId) {
        throw new Error('Invalid connection accepted payload');
      }
      
      logger.debug(`[CallbackQueueProcessor] Sending connection accepted notification to user ${userId}`);
      // We could implement this using websocket-utils if needed
      // For now, just log success
      logger.debug(`[CallbackQueueProcessor] ✅ Connection accepted notification processed for user ${userId}`);
      return true;
    } catch (error) {
      logger.error(`[CallbackQueueProcessor] Error handling connection accepted for user ${userId}:`, error);
      return false;
    }
  }
}

// Export singleton instance
import { storage } from '../storage';
export const callbackQueueProcessor = new CallbackQueueProcessor(storage);
