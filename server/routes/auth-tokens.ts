import { Router } from 'express';
import { storage } from '../storage';
import { 
  generateAccessToken, 
  generateRefreshToken, 
  hashRefreshToken,
  getRefreshTokenExpiry,
  createDeviceInfo,
  isRefreshTokenExpired
} from '../lib/jwt-service';
import { requireAuth, requireAuthJWT } from '../auth';
import { logger } from '../lib/logger';
import { logSecurityEvent, extractRequestMetadata } from '../lib/security-logger';
import { issueWebSocketTicket } from '../lib/websocket-tickets';

const router = Router();

router.post('/ws-ticket', requireAuthJWT, async (req, res) => {
  try {
    if (!req.user?.id) return res.sendStatus(401);
    const ticket = await issueWebSocketTicket(req.user.id, req.sessionID);
    return res.json({ ticket, expiresInSeconds: 60 });
  } catch (error) {
    logger.error('[Auth] WebSocket ticket issuance failed:', error);
    return res.status(503).json({ message: 'WebSocket authentication is temporarily unavailable' });
  }
});

/**
 * POST /api/auth/refresh
 * Token Rotation Endpoint
 * 
 * Validates a refresh token, rotates it (deletes old, creates new),
 * and returns new access + refresh tokens
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken, deviceId } = req.body;

    // Validate request body
    if (!refreshToken || !deviceId) {
      logSecurityEvent('warn', 'Token Refresh - Missing Fields', {
        action: 'validation_failed',
        deviceId: deviceId || 'unknown',
        userId: 'unknown',
        ...extractRequestMetadata(req),
        details: { hasRefreshToken: !!refreshToken, hasDeviceId: !!deviceId }
      });
      return res.status(400).json({ 
        message: 'Missing required fields: refreshToken and deviceId are required' 
      });
    }

    logger.info('[Token Refresh] Processing refresh request for deviceId:', deviceId);

    // Hash the incoming refresh token
    const hashedToken = hashRefreshToken(refreshToken);

    // Get token from database
    const tokenRecord = await storage.getRefreshTokenByHash(hashedToken);

    // Check if token exists
    if (!tokenRecord) {
      logSecurityEvent('error', 'Token Refresh - Token Not Found', {
        action: 'possible_reuse',
        userId: 'unknown',
        deviceId,
        ...extractRequestMetadata(req)
      });
      
      // Log potential token reuse (security event)
      try {
        await storage.logRefreshTokenReuse({
          userId: 0, // Unknown user since token doesn't exist
          deviceId,
          tokenHash: hashedToken,
          detectedAt: new Date().toISOString(),
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          action: 'logged'
        });
      } catch (logError) {
        logger.error('[Token Refresh] Failed to log token reuse:', logError);
      }

      return res.status(401).json({ 
        message: 'Invalid or expired refresh token' 
      });
    }

    // Check if token is expired
    if (isRefreshTokenExpired(tokenRecord.expiresAt)) {
      logSecurityEvent('warn', 'Token Refresh - Token Expired', {
        action: 'token_expired',
        userId: tokenRecord.userId,
        deviceId,
        ...extractRequestMetadata(req),
        details: { expiresAt: tokenRecord.expiresAt }
      });

      // Clean up expired token
      await storage.deleteRefreshToken(hashedToken);

      return res.status(401).json({ 
        message: 'Refresh token has expired. Please log in again.' 
      });
    }

    // Validate device ID matches
    if (tokenRecord.deviceId !== deviceId) {
      logSecurityEvent('error', 'Token Refresh - Device Mismatch', {
        action: 'device_mismatch',
        userId: tokenRecord.userId,
        deviceId,
        ...extractRequestMetadata(req),
        details: { expectedDevice: tokenRecord.deviceId, receivedDevice: deviceId }
      });

      // Log suspicious activity
      await storage.logRefreshTokenReuse({
        userId: tokenRecord.userId,
        deviceId,
        tokenHash: hashedToken,
        detectedAt: new Date().toISOString(),
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        action: 'logged'
      });

      return res.status(401).json({ 
        message: 'Device ID mismatch' 
      });
    }

    logger.debug('[Token Refresh] Token valid, getting user data');

    // Get user from database
    const user = await storage.getUser(tokenRecord.userId);

    if (!user) {
      logSecurityEvent('error', 'Token Refresh - User Not Found', {
        action: 'user_not_found',
        userId: tokenRecord.userId,
        deviceId,
        ...extractRequestMetadata(req)
      });
      await storage.deleteRefreshToken(hashedToken);
      return res.status(401).json({ 
        message: 'User not found' 
      });
    }

    logger.debug('[Token Refresh] Rotating tokens for user:', user.id);

    // Delete the old refresh token (rotation step 1)
    await storage.deleteRefreshToken(hashedToken);

    // Generate new access token
    const newAccessToken = generateAccessToken(user.id, user.email);

    // Generate new refresh token (opaque)
    const newRefreshToken = generateRefreshToken();
    const newHashedToken = hashRefreshToken(newRefreshToken);

    // Create device info
    const deviceInfo = createDeviceInfo(
      req.ip || req.headers['x-forwarded-for'] as string,
      req.headers['user-agent'],
      req.body.platform || 'unknown',
      req.body.deviceModel,
      req.body.osVersion
    );

    // Save new refresh token to database (rotation step 2)
    // Database defaults will set createdAt and lastUsedAt to now()
    await storage.createRefreshToken({
      userId: user.id,
      tokenHash: newHashedToken,
      deviceId,
      deviceInfo,
      expiresAt: getRefreshTokenExpiry()
    });

    // Update last used timestamp immediately after creation
    await storage.updateRefreshTokenLastUsed(newHashedToken);

    logSecurityEvent('info', 'Token Refresh - Success', {
      action: 'token_rotated',
      userId: user.id,
      deviceId,
      ...extractRequestMetadata(req)
    });

    // Return new tokens
    return res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });

  } catch (error) {
    const { deviceId } = req.body;
    logSecurityEvent('error', 'Token Operation - Error', {
      action: 'operation_failed',
      userId: 'unknown',
      deviceId: deviceId || 'unknown',
      ...extractRequestMetadata(req),
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    });
    return res.status(500).json({ 
      message: 'Failed to refresh token'
    });
  }
});

/**
 * POST /api/auth/revoke
 * Revoke Single Token Endpoint
 * 
 * Deletes a specific refresh token (device logout)
 */
router.post('/revoke', async (req, res) => {
  try {
    const { refreshToken, deviceId } = req.body;

    // Validate request body
    if (!refreshToken) {
      logSecurityEvent('warn', 'Token Revoke - Missing Token', {
        action: 'validation_failed',
        userId: 'unknown',
        deviceId: deviceId || 'unknown',
        ...extractRequestMetadata(req)
      });
      return res.status(400).json({ 
        message: 'Refresh token is required' 
      });
    }

    logger.debug('[Token Revoke] Revoking token for deviceId:', deviceId || 'unknown');

    // Hash the refresh token
    const hashedToken = hashRefreshToken(refreshToken);

    // Delete the token from database
    await storage.deleteRefreshToken(hashedToken);

    logSecurityEvent('info', 'Token Revoke - Success', {
      action: 'token_revoked',
      userId: 'unknown',
      deviceId: deviceId || 'unknown',
      ...extractRequestMetadata(req)
    });

    return res.status(200).json({ 
      message: 'Token revoked successfully' 
    });

  } catch (error) {
    const { deviceId } = req.body;
    logSecurityEvent('error', 'Token Operation - Error', {
      action: 'operation_failed',
      userId: 'unknown',
      deviceId: deviceId || 'unknown',
      ...extractRequestMetadata(req),
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    });
    return res.status(500).json({ 
      message: 'Failed to revoke token'
    });
  }
});

/**
 * POST /api/auth/revoke-all
 * Revoke All Tokens Endpoint
 * 
 * SECURITY: Requires authentication - only authenticated users can revoke their own tokens
 * Deletes all refresh tokens for the authenticated user (full logout from all devices)
 */
router.post('/revoke-all', requireAuth, async (req, res) => {
  try {
    // Get userId from authenticated session instead of request body
    const userId = req.user!.id;

    logger.debug('[Token Revoke All] Revoking all tokens for user:', userId);

    // Delete all tokens for this authenticated user
    await storage.deleteAllUserTokens(userId);

    logSecurityEvent('info', 'Token Revoke All - Success', {
      action: 'all_tokens_revoked',
      userId,
      deviceId: 'all',
      ...extractRequestMetadata(req)
    });

    return res.status(200).json({ 
      message: 'All tokens revoked successfully' 
    });

  } catch (error) {
    const userId = req.user?.id || 'unknown';
    logSecurityEvent('error', 'Token Operation - Error', {
      action: 'operation_failed',
      userId: userId,
      deviceId: 'all',
      ...extractRequestMetadata(req),
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    });
    return res.status(500).json({ 
      message: 'Failed to revoke all tokens'
    });
  }
});

export default router;
