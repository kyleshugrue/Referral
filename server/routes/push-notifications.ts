import express from "express";
import { registerDeviceToken, removeDeviceToken, sendPushNotification } from "../services/push-notifications";
import { z } from "zod";
import * as admin from 'firebase-admin';
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration';
import { logger } from '../lib/logger';
import { parseStrictPositiveInteger } from '../lib/request-validation';
import {
  pushDiagnosticsLimiter,
  pushRegistrationLimiter,
  pushTestLimiter,
} from '../lib/rate-limits';

const router = express.Router();

// Chain both middlewares: auth first, then registration check
router.use(requireAuthJWT);
router.use(requireCompleteRegistration);

// Schema for device token registration with optional device metadata
const registerTokenSchema = z.object({
  deviceToken: z.string().trim().min(20, "Device token is required").max(4096),
  platform: z.literal("ios-native"),
  deviceId: z.string().trim().min(1).max(128).optional(),
  deviceModel: z.string().trim().min(1).max(128).optional(),
  osVersion: z.string().trim().min(1).max(64).optional()
});

// Schema for device token removal
const removeTokenSchema = z.object({
  deviceToken: z.string().min(1, "Device token is required")
});

/**
 * Health check endpoint for push notification system
 * GET /api/push-notifications/health
 */
router.get("/health", async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    firebase: {
      initialized: admin.apps.length > 0,
      appName: admin.apps.length > 0 && admin.apps[0] ? admin.apps[0].name : null
    },
    authentication: {
      hasSession: !!req.session,
      isAuthenticated: req.isAuthenticated(),
      userId: req.user?.id || null
    }
  };

  logger.debug('[Push Notifications Health] System health check', {
    firebaseInitialized: health.firebase.initialized,
    hasSession: health.authentication.hasSession,
    isAuthenticated: health.authentication.isAuthenticated,
  });
  
  res.json(health);
});

/**
 * Register device token for push notifications (iOS native only)
 * POST /api/push-notifications/register
 */
router.post("/register", pushRegistrationLimiter, async (req, res) => {
  logger.debug('[Push Notifications Register] Registration attempt:', {
    hasSession: !!req.session,
    isAuthenticated: req.isAuthenticated(),
    userId: req.user?.id,
    userAgent: req.get('User-Agent'),
    sessionKeys: req.session ? Object.keys(req.session) : null
  });

  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const validation = registerTokenSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        message: "Invalid request data", 
        errors: validation.error.format() 
      });
    }

    const { deviceToken, platform, deviceId, deviceModel, osVersion } = validation.data;
    const userId = req.user.id;
    const timestamp = new Date().toISOString();

    logger.debug(`[${timestamp}] [Push Notifications Register] 📥 Received registration request:`, {
      userId,
      platform,
      fullTokenLength: deviceToken.length,
      deviceMetadata: deviceId ? { deviceId, deviceModel, osVersion } : 'none'
    });
    
    const success = await registerDeviceToken(userId, deviceToken, platform, deviceId, deviceModel, osVersion);
    
    if (success) {
      logger.debug(`[${timestamp}] [Push Notifications API] ✅ Token stored in database for user ${userId} on platform ${platform}`);
      logger.debug(`[${timestamp}] [Push Notifications API] 🎯 Registration flow complete: iOS → Capacitor → Backend → ✓ Database`);
      res.json({ success: true, message: "Device token registered successfully" });
    } else {
      logger.debug(`[${timestamp}] [Push Notifications API] ❌ Ignored device token registration for user ${userId} on platform ${platform}`);
      res.json({ success: false, message: "Device token registration not supported for this platform" });
    }
  } catch (error) {
    logger.error("Error registering device token:", error);
    res.status(500).json({ 
      message: "Failed to register device token",
       error: 'Unable to register device token'
    });
  }
});

/**
 * Remove device token for push notifications
 * POST /api/push-notifications/unregister
 */
router.post("/unregister", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const validation = removeTokenSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        message: "Invalid request data", 
        errors: validation.error.format() 
      });
    }

    const { deviceToken } = validation.data;
    const userId = req.user.id;

    const success = await removeDeviceToken(userId, deviceToken);
    
    if (success) {
      logger.debug(`[Push Notifications API] Removed device token for user ${userId}`);
      res.json({ success: true, message: "Device token removed successfully" });
    } else {
      res.json({ success: false, message: "Device token not found" });
    }
  } catch (error) {
    logger.error("Error removing device token:", error);
    res.status(500).json({ 
      message: "Failed to remove device token",
       error: 'Unable to remove device token'
    });
  }
});

/**
 * Get push notification registration status for authenticated user
 * GET /api/push-notifications/status
 */
router.get("/status", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const userId = req.user.id;
    const { storage } = await import('../storage');
    
    logger.debug('[Push Notifications Status] Checking status');
    
    // Get all tokens for this user (iOS native only)
    const tokens = await storage.getFcmTokensByUserId(userId, 'ios-native');
    
    const status = {
      hasRegisteredToken: tokens.length > 0,
      tokenCount: tokens.length,
      platform: 'ios-native',
      userId
    };
    
    logger.debug('[Push Notifications Status] Status resolved', {
      hasRegisteredToken: status.hasRegisteredToken,
      tokenCount: status.tokenCount,
    });
    
    res.json(status);
  } catch (error) {
    logger.error("Error getting push notification status", {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    res.status(500).json({ 
      message: "Failed to get push notification status",
      error: 'Unable to get push notification status'
    });
  }
});

/**
 * Send test push notification to authenticated user (iOS native only)
 * POST /api/push-notifications/test
 */
router.post("/test", pushTestLimiter, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const userId = req.user.id;
    
    logger.debug('[Push Notifications API] Sending test notification');
    
    const success = await sendPushNotification({
      userId,
      title: "Test Push Notification",
      body: "This is a test notification from your app to verify push notifications are working correctly in TestFlight.",
      data: {
        type: "test",
        timestamp: new Date().toISOString()
      }
    });
    
    if (success) {
      logger.debug('[Push Notifications API] Test notification sent successfully');
      res.json({ 
        success: true, 
        message: "Test push notification sent successfully",
        timestamp: new Date().toISOString()
      });
    } else {
      logger.warn('[Push Notifications API] Test notification was not sent');
      res.status(400).json({ 
        success: false, 
        message: "Failed to send test notification. Make sure you have registered a device token.",
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error("Error sending test push notification", {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    res.status(500).json({ 
      message: "Failed to send test push notification",
      error: 'Unable to send test push notification',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Comprehensive diagnostic endpoint for push notifications (self-access only)
 * POST /api/push-notifications/diagnostics/:userId
 * Provides detailed information about Firebase, tokens, and notification status
 * SECURITY: Users can only run diagnostics for their own account
 */
router.post("/diagnostics/:userId", pushDiagnosticsLimiter, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const targetUserId = parseStrictPositiveInteger(req.params.userId);
    const currentUserId = req.user.id;
    const timestamp = new Date().toISOString();
    
    // Validate userId parameter
    if (!targetUserId) {
      return res.status(400).json({ 
        message: "Invalid user ID",
        timestamp
      });
    }
    
    // SECURITY: Only allow users to run diagnostics on themselves
    if (targetUserId !== currentUserId) {
      logger.warn(`[${timestamp}] [Push-Diagnostics] Authorization failed for self-service diagnostics`);
      return res.status(403).json({ 
        message: "Forbidden: You can only run diagnostics for your own account",
        timestamp
      });
    }
    
    logger.debug(`[${timestamp}] [Push-Diagnostics] Starting self-service diagnostics`);
    
    const { storage } = await import('../storage');
    
    // 1. Firebase Admin Status
    const firebaseStatus = {
      initialized: admin.apps.length > 0,
      appCount: admin.apps.length,
      appName: admin.apps.length > 0 && admin.apps[0] ? admin.apps[0].name : null,
      hasMessaging: false
    };
    
    if (admin.apps.length > 0) {
      try {
        const messaging = admin.messaging();
        firebaseStatus.hasMessaging = !!messaging;
      } catch {
        firebaseStatus.hasMessaging = false;
      }
    }
    
    logger.debug(`[${timestamp}] [Push-Diagnostics] Firebase status`, {
      initialized: firebaseStatus.initialized,
      hasMessaging: firebaseStatus.hasMessaging,
    });
    
    // 2. FCM Tokens for User (count only, no token data exposed)
    const tokens = await storage.getFcmTokensByUserId(targetUserId, 'ios-native');
    logger.debug(`[${timestamp}] [Push-Diagnostics] Token count resolved`, {
      count: tokens.length,
    });
    
    // 3. Badge Count
    const badgeCounts = await storage.getUnreadNotificationCounts(targetUserId);
    const totalBadge = badgeCounts.messages + badgeCounts.connectionRequests + badgeCounts.newConnections;
    
    logger.debug(`[${timestamp}] [Push-Diagnostics] Badge count resolved`, {
      total: totalBadge,
    });
    
    // 4. Test Send Attempt
    let testSendResult: boolean | { success?: boolean; error?: string } | null = null;
    if (tokens.length > 0) {
      logger.debug(`[${timestamp}] [Push-Diagnostics] Attempting test send`);
      try {
        testSendResult = await sendPushNotification({
          userId: targetUserId,
          title: "Diagnostic Test",
          body: "This is a diagnostic test notification. If you see this, push notifications are working!",
          data: {
            type: "diagnostic_test",
            timestamp
          }
        });
        logger.debug(`[${timestamp}] [Push-Diagnostics] Test send result:`, {
          success: typeof testSendResult === 'boolean'
            ? testSendResult === true
            : false,
        });
      } catch (sendError) {
        logger.error(`[${timestamp}] [Push-Diagnostics] Test send failed`, {
          errorClass: sendError instanceof Error ? sendError.name : 'UnknownError',
        });
        testSendResult = { error: 'Diagnostic test send failed' };
      }
    } else {
      logger.debug(`[${timestamp}] [Push-Diagnostics] Skipping test send - no tokens found`);
    }
    
    // Compile diagnostics (NO sensitive token data exposed)
    const diagnostics = {
      timestamp,
      userId: targetUserId,
      firebase: firebaseStatus,
      tokens: {
        count: tokens.length,
        platform: 'ios-native'
        // Token details removed for security
      },
      badgeCount: {
        ...badgeCounts,
        total: totalBadge
      },
      testSend: testSendResult,
      summary: {
        canSendNotifications: firebaseStatus.initialized && firebaseStatus.hasMessaging && tokens.length > 0,
        issues: [] as string[]
      }
    };
    
    // Identify issues
    if (!firebaseStatus.initialized) {
      diagnostics.summary.issues.push('Firebase Admin not initialized');
    }
    if (!firebaseStatus.hasMessaging) {
      diagnostics.summary.issues.push('Firebase Messaging not available');
    }
    if (tokens.length === 0) {
      diagnostics.summary.issues.push('No FCM tokens registered for this user');
    }
    if (totalBadge === 0) {
      diagnostics.summary.issues.push('Badge count is 0 (notification may not have been created yet)');
    }
    
    logger.debug(`[${timestamp}] [Push-Diagnostics] Diagnostics complete`, diagnostics.summary);
    
    res.json(diagnostics);
  } catch (error) {
    logger.error('[Push-Diagnostics] Error running diagnostics', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    res.status(500).json({ 
      message: "Failed to run push notification diagnostics",
      error: 'Unable to run push notification diagnostics',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;