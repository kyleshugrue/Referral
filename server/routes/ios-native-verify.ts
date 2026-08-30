import { Router } from 'express';
import { storage } from '../storage';
import { auth } from '../lib/firebase-admin';
import { logger } from '../lib/logger';
import { requireTrustedOriginForSessionMutation } from '../lib/http-security';

const router = Router();

// Dedicated secure endpoint for iOS native email verification bypass
// This endpoint requires proper Firebase token verification before setting emailVerified=true
router.post('/', requireTrustedOriginForSessionMutation, async (req, res) => {
  if (
    req.get('X-Platform') !== 'ios-native' ||
    req.get('X-Capacitor-Platform') !== 'ios'
  ) {
    return res.status(403).json({ message: 'Native verification is restricted to iOS clients' });
  }

  logger.debug("📱 [IOS-NATIVE-VERIFY] Starting iOS native verification...", {
    hasToken: !!req.body.token,
    timestamp: new Date().toISOString(),
    userAgent: req.get('User-Agent')
  });

  if (!req.isAuthenticated()) {
    logger.debug("❌ [IOS-NATIVE-VERIFY] Not authenticated");
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const { token } = req.body;
    const userId = req.user.id;
    
    if (!token) {
      logger.debug("❌ [IOS-NATIVE-VERIFY] No Firebase token provided");
      return res.status(400).json({ message: 'Firebase token is required for iOS native verification' });
    }
    
    try {
      // Verify the Firebase token using Firebase Admin
      logger.debug(`🎟️ [IOS-NATIVE-VERIFY] Verifying Firebase token for user ${userId}...`);
      const decodedToken = await auth.verifyIdToken(token);
      const firebaseUid = decodedToken.uid;

      if (!('email_verified' in decodedToken) || decodedToken.email_verified !== true) {
        return res.status(403).json({ message: 'Firebase email is not verified' });
      }
      
      logger.debug('✅ [IOS-NATIVE-VERIFY] Firebase token verified successfully:', {
        userId: userId
      });
      
      // Get current user to ensure they exist and have the right Firebase UID
      const currentUser = await storage.getUser(userId);
      if (!currentUser) {
        logger.error(`❌ [IOS-NATIVE-VERIFY] User ${userId} not found in database`);
        return res.status(404).json({ message: "User not found" });
      }
      
      // Verify the Firebase UID matches
      if (currentUser.firebaseUid !== firebaseUid) {
        logger.error(`❌ [IOS-NATIVE-VERIFY] Firebase UID mismatch for user ${userId}`);
        return res.status(403).json({ message: "Firebase UID mismatch" });
      }
      
      // For iOS native apps, we set emailVerified=true since email verification
      // is not required on native platforms where app installation provides trust
      logger.debug(`📱 [IOS-NATIVE-VERIFY] Setting emailVerified=true for iOS native user ${userId}`);
      
      // SECURITY FIX: Only set emailVerified, NOT registrationCompleted
      // registrationCompleted should ONLY be set when user explicitly presses Complete Registration button
      const updateData: Record<string, unknown> = {
        emailVerified: true,
        emailVerificationStarted: false // iOS native doesn't need verification flow
      };
      
      const updatedUser = await storage.updateUser(userId, updateData);
      
      if (!updatedUser) {
        logger.error(`❌ [IOS-NATIVE-VERIFY] Failed to update user ${userId}`);
        return res.status(500).json({ message: "Failed to update user verification status" });
      }
      
      logger.debug(`✅ [IOS-NATIVE-VERIFY] Successfully verified iOS native user ${userId}:`, {
        emailVerified: updatedUser.emailVerified,
        registrationCompleted: updatedUser.registrationCompleted
      });
      
      // Return the updated user data
      return res.json({
        success: true,
        message: "iOS native verification successful",
        user: {
          id: updatedUser.id,
          emailVerified: updatedUser.emailVerified,
          registrationCompleted: updatedUser.registrationCompleted
        }
      });
      
    } catch (tokenError) {
      logger.error('❌ [IOS-NATIVE-VERIFY] Firebase token verification failed:', {
        error: tokenError instanceof Error ? tokenError.message : tokenError,
        userId: userId,
        tokenPresent: !!token
      });
      return res.status(401).json({ message: 'Invalid Firebase token' });
    }
  } catch (error) {
    logger.error('💥 [IOS-NATIVE-VERIFY] Critical error:', {
      error,
      userId: req.user?.id
    });
    return res.status(500).json({ message: "iOS native verification failed" });
  }
});

export default router;