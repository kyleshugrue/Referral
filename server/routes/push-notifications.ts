import express from "express";
import { registerDeviceToken, removeDeviceToken, sendPushNotification } from "../services/push-notifications";
import { z } from "zod";
import * as admin from 'firebase-admin';
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration';
import { logger } from '../lib/logger';

const router = express.Router();

// Chain both middlewares: auth first, then registration check
router.use(requireAuthJWT);
router.use(requireCompleteRegistration);

// Schema for device token registration with optional device metadata
const registerTokenSchema = z.object({
  deviceToken: z.string().min(1, "Device token is required"),
  platform: z.string().min(1, "Platform is required"),
  deviceId: z.string().optional(),
  deviceModel: z.string().optional(),
  osVersion: z.string().optional()
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

  console.log('[Push Notifications Health] System health check:', health);
  
  res.json(health);
});

/**
 * Register device token for push notifications (iOS native only)
 * POST /api/push-notifications/register
 */
router.post("/register", async (req, res) => {
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
      error: error instanceof Error ? error.message : 'Unknown error'
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
      error: error instanceof Error ? error.message : 'Unknown error'
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
    
    console.log(`[Push Notifications Status] Checking status for user ${userId}`);
    
    // Get all tokens for this user (iOS native only)
    const tokens = await storage.getFcmTokensByUserId(userId, 'ios-native');
    
    const status = {
      hasRegisteredToken: tokens.length > 0,
      tokenCount: tokens.length,
      platform: 'ios-native',
      userId
    };
    
    console.log(`[Push Notifications Status] Status for user ${userId}:`, status);
    
    res.json(status);
  } catch (error) {
    console.error("Error getting push notification status:", error);
    res.status(500).json({ 
      message: "Failed to get push notification status",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Send test push notification to authenticated user (iOS native only)
 * POST /api/push-notifications/test
 */
router.post("/test", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const userId = req.user.id;
    
    console.log(`[Push Notifications API] Sending test notification to user ${userId}`);
    
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
      console.log(`[Push Notifications API] Test notification sent successfully to user ${userId}`);
      res.json({ 
        success: true, 
        message: "Test push notification sent successfully",
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`[Push Notifications API] Failed to send test notification to user ${userId}`);
      res.status(400).json({ 
        success: false, 
        message: "Failed to send test notification. Make sure you have registered a device token.",
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error("Error sending test push notification:", error);
    res.status(500).json({ 
      message: "Failed to send test push notification",
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Comprehensive diagnostic endpoint for push notifications (self-access only)
 * GET /api/push-notifications/diagnostics/:userId
 * Provides detailed information about Firebase, tokens, and notification status
 * SECURITY: Users can only run diagnostics for their own account
 */
router.get("/diagnostics/:userId", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const targetUserId = parseInt(req.params.userId);
    const currentUserId = req.user.id;
    const timestamp = new Date().toISOString();
    
    // Validate userId parameter
    if (isNaN(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ 
        message: "Invalid user ID",
        timestamp
      });
    }
    
    // SECURITY: Only allow users to run diagnostics on themselves
    if (targetUserId !== currentUserId) {
      console.warn(`[${timestamp}] [Push-Diagnostics] ⚠️ Authorization failed: User ${currentUserId} attempted to access diagnostics for user ${targetUserId}`);
      return res.status(403).json({ 
        message: "Forbidden: You can only run diagnostics for your own account",
        timestamp
      });
    }
    
    console.log(`[${timestamp}] [Push-Diagnostics] 🔍 Starting diagnostics for user ${targetUserId}`);
    
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
    
    console.log(`[${timestamp}] [Push-Diagnostics] Firebase status:`, firebaseStatus);
    
    // 2. FCM Tokens for User (count only, no token data exposed)
    const tokens = await storage.getFcmTokensByUserId(targetUserId, 'ios-native');
    console.log(`[${timestamp}] [Push-Diagnostics] Found ${tokens.length} token(s) for user ${targetUserId}`);
    
    // 3. Badge Count
    const badgeCounts = await storage.getUnreadNotificationCounts(targetUserId);
    const totalBadge = badgeCounts.messages + badgeCounts.connectionRequests + badgeCounts.newConnections;
    
    console.log(`[${timestamp}] [Push-Diagnostics] Badge count for user ${targetUserId}:`, {
      ...badgeCounts,
      total: totalBadge
    });
    
    // 4. Test Send Attempt
    let testSendResult: boolean | { success?: boolean; error?: string } | null = null;
    if (tokens.length > 0) {
      console.log(`[${timestamp}] [Push-Diagnostics] Attempting test send to user ${targetUserId}...`);
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
        console.error(`[${timestamp}] [Push-Diagnostics] Test send failed:`, sendError);
        testSendResult = { error: sendError instanceof Error ? sendError.message : 'Unknown error' };
      }
    } else {
      console.log(`[${timestamp}] [Push-Diagnostics] Skipping test send - no tokens found`);
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
    
    console.log(`[${timestamp}] [Push-Diagnostics] 🏁 Diagnostics complete:`, diagnostics.summary);
    
    res.json(diagnostics);
  } catch (error) {
    console.error('[Push-Diagnostics] Error running diagnostics:', error);
    res.status(500).json({ 
      message: "Failed to run push notification diagnostics",
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;