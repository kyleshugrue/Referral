import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import { auth } from '../lib/firebase-admin';
import { 
  generateAccessToken, 
  generateRefreshToken, 
  hashRefreshToken,
  getRefreshTokenExpiry,
  createDeviceInfo
} from '../lib/jwt-service';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@shared/schema';
import { logger } from '../lib/logger';
import { extractBearerToken } from '../lib/register-auth';

const router = Router();

// Helper function to complete the auth response (JWT generation, re-fetch user, send response)
// Used by both the already-authenticated path and the new-login path
async function completeAuthResponse(
  req: Request,
  res: Response,
  user: User,
  originalSessionId: string | undefined
): Promise<Response> {
  logger.debug('💾 [FIREBASE-AUTH DEBUG] Saving session to database...');
  
  return new Promise((resolve) => {
    req.session.save(async (saveErr) => {
      if (saveErr) {
        logger.error('❌ [FIREBASE-AUTH DEBUG] Session save error:', {
          error: saveErr.message,
          stack: saveErr.stack,
          sessionId: req.session?.id
        });
        resolve(res.status(500).json({ error: 'Session save failed' }));
        return;
      }
      
      logger.debug('✅ [FIREBASE-AUTH DEBUG] Session saved successfully!', {
        sessionId: req.session?.id,
        userId: user.id,
        sessionPreserved: originalSessionId === req.session?.id ? '✅ YES' : '⚠️ Changed'
      });
      
      // Generate JWT tokens for dual-mode authentication (session + JWT)
      try {
        logger.debug('🔑 [FIREBASE-AUTH DEBUG] Generating JWT tokens...');
        
        // Generate access and refresh tokens
        const accessToken = generateAccessToken(user.id, user.email);
        const refreshToken = generateRefreshToken();
        const tokenHash = hashRefreshToken(refreshToken);
        
        // Create device ID from request or generate new one
        const deviceId = req.body.deviceId || `${req.body.platform || 'web'}-${uuidv4()}`;
        
        // Create device info JSON string
        const deviceInfoJson = createDeviceInfo(
          req.ip,
          req.get('user-agent'),
          req.body.platform,
          req.body.deviceModel,
          req.body.osVersion
        );
        
        // Calculate refresh token expiry (30 days from now)
        const expiresAt = getRefreshTokenExpiry();
        
        // Store refresh token in database
        await storage.createRefreshToken({
          userId: user.id,
          tokenHash,
          deviceId,
          deviceInfo: deviceInfoJson,
          expiresAt
        });
        
        logger.debug('✅ [FIREBASE-AUTH DEBUG] JWT tokens generated and stored successfully', {
          deviceId,
          platform: req.body.platform || 'web',
          expiresAt
        });
        
        // CRITICAL FIX: Re-fetch user from database before returning response
        logger.debug('🔄 [FIREBASE-AUTH DEBUG] Re-fetching user from database to get latest data...');
        let latestUser: User | null | undefined;
        try {
          latestUser = await storage.getUser(user.id);
          if (!latestUser) {
            logger.warn('⚠️ [FIREBASE-AUTH DEBUG] Could not re-fetch user, using cached data');
            latestUser = user;
          } else {
            logger.debug('✅ [FIREBASE-AUTH DEBUG] Re-fetched latest user data successfully');
          }
        } catch (refetchError) {
          logger.error('❌ [FIREBASE-AUTH DEBUG] Error re-fetching user:', refetchError);
          latestUser = user; // Fall back to cached data
        }
        
        logger.debug("📤 [FIREBASE-AUTH DEBUG] Sending successful response to client with JWT tokens");
        
        resolve(res.status(200).json({
          ...latestUser,
          accessToken,
          refreshToken,
          deviceId // Include deviceId so client can use it for token refresh
        }));
      } catch (tokenError) {
        // If token generation fails, still return user but log the error
        logger.error('❌ [FIREBASE-AUTH DEBUG] JWT token generation failed:', tokenError);
        logger.debug('⚠️ [FIREBASE-AUTH DEBUG] Falling back to session-only authentication');
        
        // Re-fetch user from database for fallback response
        let latestUserFallback: User | null | undefined;
        try {
          latestUserFallback = await storage.getUser(user.id);
          if (!latestUserFallback) {
            latestUserFallback = user;
          }
        } catch (refetchErr) {
          logger.error('❌ [FIREBASE-AUTH DEBUG] Error re-fetching user in fallback:', refetchErr);
          latestUserFallback = user;
        }
        
        logger.debug("📤 [FIREBASE-AUTH DEBUG] Sending successful response to client (session-only, no tokens)");
        resolve(res.status(200).json(latestUserFallback));
      }
    });
  });
}

// Process Firebase authentication tokens and sync with database
router.post('/', async (req, res) => {
  logger.debug("🔥 [FIREBASE-AUTH DEBUG] Starting Firebase auth processing...", {
    hasBearerToken: !!extractBearerToken(req.headers.authorization),
    timestamp: new Date().toISOString()
  });

  try {
    const token = extractBearerToken(req.headers.authorization);
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    try {
      // Verify the Firebase token
      logger.debug("🎟️ [FIREBASE-AUTH DEBUG] Verifying Firebase token...");
      const decodedToken = await auth.verifyIdToken(token) as Awaited<ReturnType<typeof auth.verifyIdToken>> & {
        aud?: string;
        iss?: string;
        email_verified?: boolean;
         name?: string;
         picture?: string;
      };
      const firebaseUid = decodedToken.uid;
       const email = decodedToken.email;
       const displayName = decodedToken.name;
       const photoURL = decodedToken.picture;

       if (!firebaseUid || !email) {
         return res.status(401).json({ message: 'Invalid Firebase token' });
       }

       // Legacy clients may echo Firebase claims in JSON, but those values are
       // never used as identity. Reject conflicts instead of silently accepting
       // a request that tries to switch accounts.
       const body = req.body && typeof req.body === 'object' ? req.body : {};
       const claimConflicts = [
         typeof body.firebaseUid === 'string' && body.firebaseUid !== firebaseUid,
         typeof body.email === 'string' && body.email !== email,
         typeof body.emailVerified === 'boolean' && body.emailVerified !== (decodedToken.email_verified === true),
         typeof body.displayName === 'string' && displayName !== undefined && body.displayName !== displayName,
         typeof body.photoURL === 'string' && photoURL !== undefined && body.photoURL !== photoURL,
       ];
       if (claimConflicts.some(Boolean)) {
         logger.warn('[FIREBASE-AUTH] Rejected request with conflicting identity claims');
         return res.status(400).json({ message: 'Authentication claims do not match' });
       }
      
      logger.debug('✅ [FIREBASE-AUTH DEBUG] Firebase token verified successfully:', {
        uid: firebaseUid,
        aud: decodedToken.aud,
        iss: decodedToken.iss
      });
      
      // Extract email verification status from token
      const isEmailVerified = decodedToken.email_verified || false;
      logger.debug('📧 [FIREBASE-AUTH DEBUG] Firebase email verification status:', isEmailVerified);
      
      // Try to find existing user (created by partial registration) with comprehensive search
      let user;
      let attempts = 0;
      const maxAttempts = 3;
      
      logger.debug('🔍 [FIREBASE-AUTH DEBUG] Searching for existing user...', {
        firebaseUid,
         searchMethods: ['by Firebase UID', 'by verified email']
      });
      
      // CRITICAL SEARCH: Check if user exists by Firebase UID FIRST
      try {
        const usersByFirebaseUid = await storage.getUsersByFirebaseUid(firebaseUid);
        if (usersByFirebaseUid && usersByFirebaseUid.length > 0) {
          const existingUser = usersByFirebaseUid[0]; // Take the first match
           logger.debug('✅ [FIREBASE-AUTH DEBUG] Found user by Firebase UID:', {
             userId: existingUser.id
           });
          
          // Use the existing user - this solves the cross-device problem!
          user = existingUser;
          
           // A Firebase UID is a stable account binding. Never let a later
           // token silently replace the email on that account.
          if (existingUser.email !== email) {
             logger.warn('[FIREBASE-AUTH] Firebase UID/email ownership conflict');
             return res.status(409).json({ message: 'Authentication account conflict' });
          } else if (decodedToken.email_verified && !existingUser.emailVerified) {
            // Just update email verification status
            user = await storage.updateUser(existingUser.id, { emailVerified: true });
            logger.debug('✅ [FIREBASE-AUTH DEBUG] Email verification status updated');
          }
        }
      } catch (error) {
        logger.debug('❌ [FIREBASE-AUTH DEBUG] Error searching by Firebase UID:', error);
      }
      
      // Only search by email if we didn't find user by Firebase UID
      while (!user && attempts < maxAttempts) {
        attempts++;
        try {
           // Fallback linking uses only the verified email claim.
          logger.debug(`🔍 [FIREBASE-AUTH DEBUG] Attempt ${attempts}: Searching by email...`);
          user = await storage.getUserByEmail(email);
          
          // Check if we got a valid user object
          if (user && user.id) {
            logger.debug('✅ [FIREBASE-AUTH DEBUG] Found existing user by email lookup:', {
              userId: user.id,
              hasFirebaseUid: !!user.firebaseUid,
              emailVerified: user.emailVerified,
              registrationCompleted: user.registrationCompleted
            });

             if (user.firebaseUid && user.firebaseUid !== firebaseUid) {
               logger.warn('[FIREBASE-AUTH] Firebase email/UID ownership conflict');
               return res.status(409).json({ message: 'Authentication account conflict' });
             }
             if (!user.firebaseUid && !isEmailVerified) {
               return res.status(409).json({ message: 'Email verification required' });
             }
            
            // Update Firebase UID and email verification status
            const updateData: { firebaseUid?: string; emailVerified?: boolean } = {};
            if (!user.firebaseUid) {
              updateData.firebaseUid = firebaseUid;
              logger.debug('🔗 [FIREBASE-AUTH DEBUG] Linking Firebase UID to existing user');
            }
            
            // BINARY SYSTEM: Update emailVerified field if Firebase confirms verification
            if (isEmailVerified && !user.emailVerified) {
              updateData.emailVerified = true;
              logger.debug('✅ [FIREBASE-AUTH DEBUG] Setting emailVerified to true based on Firebase verification');
            }
            
            // Only update if we have changes to make
            if (Object.keys(updateData).length > 0) {
             logger.debug('📝 [FIREBASE-AUTH DEBUG] Updating authenticated user linkage');
              const updatedUser = await storage.updateUser(user.id, updateData);
              logger.debug('✅ [FIREBASE-AUTH DEBUG] User updated successfully:', !!updatedUser);
              user = updatedUser;
            }
            
            logger.debug('🎯 [FIREBASE-AUTH DEBUG] Using existing user with real data:', {
              userId: user.id,
              fullName: user.fullName,
              hasRealBirthday: !!user.birthday && user.birthday !== ''
            });
            break; // Success, exit retry loop
          } else if (user === undefined) {
            // Database connection issue or user not found
            logger.warn(`⚠️ [FIREBASE-AUTH DEBUG] Attempt ${attempts}: getUserByEmail returned undefined - possible connection issue`);
            if (attempts < maxAttempts) {
              logger.debug(`🔄 [FIREBASE-AUTH DEBUG] Retrying in 1 second... (attempt ${attempts + 1}/${maxAttempts})`);
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            } else {
              logger.debug('❌ [FIREBASE-AUTH DEBUG] Max attempts reached, treating as user not found');
              user = null; // Set to null to trigger user creation below
              break;
            }
          } else {
            // User exists but has invalid data
            logger.error('❌ [FIREBASE-AUTH DEBUG] User object found but missing ID:', user);
            throw new Error('Invalid user data retrieved from database');
          }
        } catch (error) {
          logger.debug(`❌ [FIREBASE-AUTH DEBUG] Attempt ${attempts}: Error in getUserByEmail:`, error);
          
          // If error is "user not found", that's expected for new users
          if (error instanceof Error && error.message.includes('not found')) {
            logger.debug('📋 [FIREBASE-AUTH DEBUG] No existing user found by email - will need to create new user');
            user = null; // Set to null to trigger user creation below
            break;
          }
          
          // For other errors, retry if we have attempts left
          if (attempts < maxAttempts) {
            logger.debug(`🔄 [FIREBASE-AUTH DEBUG] Retrying in 1 second... (attempt ${attempts + 1}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          } else {
            logger.error('💥 [FIREBASE-AUTH DEBUG] Max attempts reached, database query failed:', error);
            throw error;
          }
        }
      }
      
      // If we don't have a valid user after all attempts, create a new one
      // WARNING: This should only happen if partial registration failed
      if (!user) {
        logger.debug('⚠️ [FIREBASE-AUTH DEBUG] No existing user found - creating new user as fallback');
        logger.debug('🚨 [FIREBASE-AUTH DEBUG] This means partial registration may have failed or user never registered through the app');
        logger.debug('📋 [FIREBASE-AUTH DEBUG] Creating user with Firebase credentials only (limited data)');
          
          // Create basic user with Firebase info and binary authentication fields
          // NOTE: This is a fallback - user will have minimal data compared to proper registration
          user = await storage.createUser({
            email,
            password: 'FIREBASE_AUTH', // Placeholder since Firebase handles auth
             fullName: displayName || email.split('@')[0], // Limited - no real full name
            birthday: '', // Missing - no birthday data
            title: '',
            currentLocation: '',
            industry: 'Other',
            currentCompany: '',
            yearsOfExperience: 0,
            interests: [],
            professionalInterests: [],
            languages: [],
             photo: photoURL || '/placeholder.jpg',
            profileVisible: true,
            emailNotifications: true,
            readReceipts: true,
            firebaseUid,
            // BINARY SYSTEM: Set authentication fields based on Firebase status
            emailVerificationStarted: true, // Firebase account creation starts verification
            emailVerified: isEmailVerified, // Use Firebase verification status
            registrationCompleted: false // Registration not complete until user finishes flow
          });
          
          logger.debug('⚠️ [FIREBASE-AUTH DEBUG] Created fallback user from Firebase auth:', { 
            id: user.id, 
            hasBirthday: !!user.birthday,
            hasRealName: user.fullName !== email.split('@')[0],
            warning: 'User created with limited data - partial registration may have failed'
          });
      }
      
      // Log the user in using Passport's req.login() method
      logger.debug("🔐 [FIREBASE-AUTH DEBUG] Establishing Passport session...", {
        hasSession: !!req.session,
        hasUser: !!user,
        userId: user?.id,
        sessionId: req.session?.id,
        sessionCookie: req.session?.cookie
      });

      if (user) {
        const originalSessionId = req.session?.id;
        const isAlreadyAuthenticated = req.isAuthenticated() && req.user?.id === user.id;
        
        logger.debug('🔐 [FIREBASE-AUTH DEBUG] Checking if already authenticated...', {
          isAlreadyAuthenticated,
          currentUserId: req.user?.id,
          targetUserId: user.id,
          originalSessionId
        });
        
        // CRITICAL FIX: If user is already authenticated with same user ID, 
        // skip req.login() entirely to PREVENT session regeneration.
        // This avoids invalidating in-flight requests (like PATCH /api/user).
        // The Firebase token validation already proves the user's identity.
        if (isAlreadyAuthenticated) {
          logger.debug('✅ [FIREBASE-AUTH DEBUG] User already authenticated - SKIPPING req.login() to preserve session!', {
            userId: user.id,
            sessionId: originalSessionId,
            message: 'Session preserved - no regeneration needed'
          });
          
          // Just update the session data without calling req.login()
          req.session.userId = user.id;
          const sessionWithPassport = req.session as typeof req.session & {
            passport?: { user?: number };
          };
          sessionWithPassport.passport ??= {};
          sessionWithPassport.passport.user = user.id;
          
          // Continue to save session and return response
          return completeAuthResponse(req, res, user, originalSessionId);
        }
        
        // User is NOT already authenticated - proceed with req.login()
        logger.debug('💾 [FIREBASE-AUTH DEBUG] User not authenticated - calling req.login() for Passport authentication...');
        
        req.session.userId = user.id;
        logger.debug('🔒 [FIREBASE-AUTH DEBUG] Set session.userId BEFORE req.login()', {
          originalSessionId,
          userId: user.id
        });
        
        req.login(user, (err) => {
          if (err) {
            logger.error('❌ [FIREBASE-AUTH DEBUG] Passport login error:', {
              error: err.message,
              stack: err.stack,
              sessionId: req.session?.id
            });
            return res.status(500).json({ error: 'Passport login failed' });
          }
          
          const newSessionId = req.session?.id;
          const sessionPreserved = originalSessionId === newSessionId;
          logger.debug('✅ [FIREBASE-AUTH DEBUG] Passport login successful!', {
            userId: user.id,
            originalSessionId,
            newSessionId,
            sessionPreserved: sessionPreserved ? '✅ YES - Session ID unchanged' : '⚠️ Session regenerated (expected for new login)',
            registrationCompleted: user.registrationCompleted,
            emailVerified: user.emailVerified,
            isAuthenticated: req.isAuthenticated()
          });
          
          req.session.userId = user.id;
          logger.debug('🔒 [FIREBASE-AUTH DEBUG] Set session.userId AFTER req.login()');
          
          // Use the shared helper for session save, JWT generation, and response
          completeAuthResponse(req, res, user, originalSessionId);
        });
      } else {
        logger.error('❌ [FIREBASE-AUTH DEBUG] Critical error - no user found:', { 
          hasSession: !!req.session, 
          hasUser: !!user
        });
        return res.status(500).json({ error: 'User authentication failed' });
      }
    } catch (tokenError) {
      logger.error('❌ [FIREBASE-AUTH DEBUG] Firebase token verification failed:', {
        error: tokenError instanceof Error ? tokenError.message : 'Unknown error',
        hasToken: !!token
      });
      return res.status(401).json({ message: 'Invalid Firebase token' });
    }
  } catch (error) {
    logger.error('💥 [FIREBASE-AUTH DEBUG] Critical error in Firebase auth processing:', { error });
    return res.status(500).json({ message: 'Authentication failed' });
  }
});

export default router;