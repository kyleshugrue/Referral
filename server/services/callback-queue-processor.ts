import type { IStorage } from '../storage';
import type { CallbackNotification } from '../../shared/schema';
import { broadcastMatchRefresh, notifyConnectionAccepted, notifyConnectionRequest } from '../websocket-utils';
import { logger } from '../lib/logger';
import { recordQueueEvent, setQueueDepth } from '../lib/operational-metrics';
import { decideQueueDelivery } from './queue-delivery-policy';

type CallbackPayload = Record<string, unknown>;

export class CallbackQueueProcessor {
  private storage: IStorage;
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private queueRunActive = false;
  private readonly POLL_INTERVAL_MS = 5000;
  private readonly MAX_ATTEMPTS = 3; // Maximum retry attempts per notification

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Start the callback queue processor
   * Polls the queue every five seconds and processes pending notifications
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

    // Then process every five seconds
    this.processingInterval = setInterval(() => {
      this.processQueue().catch(error => {
        logger.error('[CallbackQueueProcessor] Error in periodic queue processing:', error);
      });
    }, this.POLL_INTERVAL_MS);

    logger.info('[CallbackQueueProcessor] Callback queue processor started', { pollIntervalMs: this.POLL_INTERVAL_MS });
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
    if (this.queueRunActive) {
      logger.debug('[CallbackQueueProcessor] Previous queue run is still active');
      return;
    }
    this.queueRunActive = true;
    try {
      const initialStats = await this.storage.getCallbackNotificationStats();
      setQueueDepth('callbacks', initialStats.pending + initialStats.processing);
      // Claim each item atomically so multiple app instances cannot deliver it twice.
      const pendingNotifications: CallbackNotification[] = [];
      for (let i = 0; i < 100; i++) {
        const notification = await this.storage.claimPendingCallbackNotification();
        if (!notification) break;
        pendingNotifications.push(notification);
        recordQueueEvent('callbacks', 'claimed');
      }
      if (pendingNotifications.length === 0) {
        logger.debug('[CallbackQueueProcessor] No pending notifications to process');
        return;
      }

       logger.info('[CallbackQueueProcessor] Processing pending notifications', { count: pendingNotifications.length });

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

       logger.info('[CallbackQueueProcessor] Processed notifications', { successCount, failureCount });
      const finalStats = await this.storage.getCallbackNotificationStats();
      setQueueDepth('callbacks', finalStats.pending + finalStats.processing);
    } catch (error) {
      logger.error('[CallbackQueueProcessor] Error processing queue:', error);
    } finally {
      this.queueRunActive = false;
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
         logger.debug('[CallbackQueueProcessor] Notification expired; marking as failed', { notificationId });
        await this.storage.updateCallbackNotification(notificationId, {
          status: 'failed',
          errorMessage: 'Notification expired',
          lastAttemptAt: now.toISOString()
        });
        recordQueueEvent('callbacks', 'failed');
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
         logger.error('[CallbackQueueProcessor] Invalid JSON payload', error, { notificationId });
        await this.storage.updateCallbackNotification(notificationId, {
          status: 'failed',
          errorMessage: 'Invalid JSON payload',
          lastAttemptAt: now.toISOString()
        });
        recordQueueEvent('callbacks', 'failed');
        return false;
      }

       logger.debug('[CallbackQueueProcessor] Processing notification', { notificationId, notificationType, userId });

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
           logger.warn('[CallbackQueueProcessor] Unknown notification type', { notificationType });
          success = false;
      }

      // Update notification status
      if (success) {
        await this.storage.updateCallbackNotification(notificationId, {
          status: 'completed'
        });
        recordQueueEvent('callbacks', 'completed');
         logger.debug('[CallbackQueueProcessor] Successfully processed notification', { notificationId });
        return true;
      } else {
        // Check if we should retry
        const decision = decideQueueDelivery('retryable-failure', notification.attemptCount, this.MAX_ATTEMPTS);
        if (decision.status === 'failed') {
          await this.storage.updateCallbackNotification(notificationId, {
            status: decision.status,
            errorMessage: decision.errorMessage,
          });
          recordQueueEvent('callbacks', 'failed');
          logger.warn('[CallbackQueueProcessor] Notification permanently failed', {
            notificationId,
            attemptCount: notification.attemptCount,
          });
        } else {
          // Reset to pending for retry
          await this.storage.updateCallbackNotification(notificationId, {
            status: 'pending'
          });
          logger.debug('[CallbackQueueProcessor] Notification will be retried', {
            notificationId,
            attemptCount: notification.attemptCount,
            maxAttempts: this.MAX_ATTEMPTS,
          });
        }
        return false;
      }
    } catch (error) {
       logger.error('[CallbackQueueProcessor] Error processing notification', error, { notificationId });
      
      // Check if we should retry
      const decision = decideQueueDelivery('retryable-failure', notification.attemptCount, this.MAX_ATTEMPTS);
      if (decision.status === 'failed') {
        await this.storage.updateCallbackNotification(notificationId, {
          status: decision.status,
          errorMessage: decision.errorMessage,
        });
        recordQueueEvent('callbacks', 'failed');
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
       logger.debug('[CallbackQueueProcessor] Sending match refresh', { userId });
      const success = await broadcastMatchRefresh(userId);
      if (success) {
         logger.debug('[CallbackQueueProcessor] Match refresh broadcast sent', { userId });
        return true;
      } else {
        // CRITICAL FIX: Return false when user is offline so notification stays pending
        // This ensures retry on next poll cycle when user might be connected
         logger.debug('[CallbackQueueProcessor] User not connected; will retry on next poll', { userId });
        return false;
      }
    } catch (error) {
       logger.error('[CallbackQueueProcessor] Error broadcasting match refresh', error, { userId });
      return false;
    }
  }

  /**
   * Handle connection request notification
   */
  private async handleConnectionRequest(userId: number, payload: CallbackPayload): Promise<boolean> {
    try {
       const senderId = Number(payload.senderId);
       const requestId = Number(payload.requestId);
       if (!Number.isInteger(senderId) || senderId <= 0 || !Number.isInteger(requestId) || requestId <= 0) {
        throw new Error('Invalid connection request payload');
      }
      
       const deliveredByWebSocket = await notifyConnectionRequest(userId, senderId, requestId);
       if (deliveredByWebSocket) return true;

       const sender = await this.storage.getUser(senderId);
       if (!sender) return false;
       const { sendPushNotification } = await import('./push-notifications');
       return sendPushNotification({
         userId,
         title: 'New Connection Request',
         body: `${sender.fullName} wants to connect with you`,
         data: {
           type: 'connection_request',
           sender_id: String(senderId),
           request_id: String(requestId),
         },
       }, { queueOnFailure: false });
    } catch (error) {
       logger.error('[CallbackQueueProcessor] Error handling connection request', error, { userId });
      return false;
    }
  }

  /**
   * Handle connection accepted notification
   */
  private async handleConnectionAccepted(userId: number, payload: CallbackPayload): Promise<boolean> {
    try {
       const acceptedById = Number(payload.acceptedById);
       const requestId = Number(payload.requestId);
       if (!Number.isInteger(acceptedById) || acceptedById <= 0 || !Number.isInteger(requestId) || requestId <= 0) {
        throw new Error('Invalid connection accepted payload');
      }
      
       const deliveredByWebSocket = await notifyConnectionAccepted(userId, requestId, acceptedById);
       if (deliveredByWebSocket) return true;

       const accepter = await this.storage.getUser(acceptedById);
       if (!accepter) return false;
       const { sendPushNotification } = await import('./push-notifications');
       return sendPushNotification({
         userId,
         title: 'Connection Accepted',
         body: `${accepter.fullName} accepted your connection request`,
         data: {
           type: 'connection_accepted',
           accepter_id: String(acceptedById),
           request_id: String(requestId),
         },
       }, { queueOnFailure: false });
    } catch (error) {
       logger.error('[CallbackQueueProcessor] Error handling connection accepted', error, { userId });
      return false;
    }
  }
}

// Export singleton instance
import { storage } from '../storage';
export const callbackQueueProcessor = new CallbackQueueProcessor(storage);
