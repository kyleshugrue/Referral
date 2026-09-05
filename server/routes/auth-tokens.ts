import { Router } from 'express';
import { storage } from '../storage';
import { 
  generateAccessToken, 
  generateRefreshToken, 
  hashRefreshToken,
  getRefreshTokenExpiry,
  createDeviceInfo
} from '../lib/jwt-service';
import { requireAuthJWT } from '../auth';
import { logger } from '../lib/logger';
import { logSecurityEvent, extractRequestMetadata } from '../lib/security-logger';
import { issueWebSocketTicket } from '../lib/websocket-tickets';
import { boundedString } from '../lib/request-validation';

const router = Router();

router.post('/ws-ticket', requireAuthJWT, async (req, res) => {
  try {
    if (!req.user?.id) return res.sendStatus(401);
    const ticket = await issueWebSocketTicket(req.user.id, req.sessionID);
    return res.json({ ticket, expiresInSeconds: 60 });
  } catch (error) {
    logger.error('[Auth] WebSocket ticket issuance failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
      operation: 'websocket_ticket',
    });
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
    const normalizedRefreshToken = boundedString(refreshToken, 4096);
    const normalizedDeviceId = boundedString(deviceId, 256);
    if (!normalizedRefreshToken || !normalizedDeviceId) {
      logSecurityEvent('warn', 'Token Refresh - Missing Fields', {
        action: 'validation_failed',
        deviceId: normalizedDeviceId || 'unknown',
        userId: 'unknown',
        ...extractRequestMetadata(req),
        details: { hasRefreshToken: !!refreshToken, hasDeviceId: !!deviceId }
      });
      return res.status(400).json({ 
        message: 'Missing required fields: refreshToken and deviceId are required' 
      });
    }

    logger.info('[Token Refresh] Processing refresh request');

    // Hash the incoming refresh token
    const hashedToken = hashRefreshToken(normalizedRefreshToken);

    const newRefreshToken = generateRefreshToken();
    const newHashedToken = hashRefreshToken(newRefreshToken);
    const deviceInfo = createDeviceInfo(
      req.ip || 'unknown',
      req.headers['user-agent'],
      req.body.platform || 'unknown',
      req.body.deviceModel,
      req.body.osVersion
    );
    const rotation = await storage.rotateRefreshToken(hashedToken, normalizedDeviceId, {
      userId: 0,
      tokenHash: newHashedToken,
      deviceId: normalizedDeviceId,
      deviceInfo,
      expiresAt: getRefreshTokenExpiry(),
    });

    if (rotation.status === 'not_found') {
      logSecurityEvent('error', 'Token Refresh - Token Not Found', {
        action: 'possible_reuse',
        userId: 'unknown',
        deviceId: normalizedDeviceId,
        ...extractRequestMetadata(req)
      });
      
      return res.status(401).json({ 
        message: 'Invalid or expired refresh token' 
      });
    }

    if (rotation.status === 'expired') {
      logSecurityEvent('warn', 'Token Refresh - Token Expired', {
        action: 'token_expired',
        userId: rotation.userId,
        deviceId: normalizedDeviceId,
        ...extractRequestMetadata(req),
      });
      return res.status(401).json({ 
        message: 'Refresh token has expired. Please log in again.' 
      });
    }

    if (rotation.status === 'device_mismatch') {
      logSecurityEvent('error', 'Token Refresh - Device Mismatch', {
        action: 'device_mismatch',
        userId: rotation.userId,
        deviceId: normalizedDeviceId,
        ...extractRequestMetadata(req),
      });
      return res.status(401).json({ 
        message: 'Device ID mismatch' 
      });
    }

    if (rotation.status === 'user_missing') {
      logSecurityEvent('error', 'Token Refresh - User Not Found', {
        action: 'user_not_found',
        userId: rotation.userId,
        deviceId: normalizedDeviceId,
        ...extractRequestMetadata(req)
      });
      return res.status(401).json({ 
        message: 'User not found' 
      });
    }

    if (rotation.status === 'account_inactive') {
      logSecurityEvent('warn', 'Token Refresh - Account Inactive', {
        action: 'account_inactive',
        userId: rotation.userId,
        deviceId: normalizedDeviceId,
        ...extractRequestMetadata(req),
      });
      return res.status(401).json({
        message: 'Account is not active',
      });
    }

    const newAccessToken = generateAccessToken(rotation.user.id, rotation.user.email);

    logSecurityEvent('info', 'Token Refresh - Success', {
      action: 'token_rotated',
       userId: rotation.user.id,
      deviceId: normalizedDeviceId,
      ...extractRequestMetadata(req)
    });

    // Return new tokens
    return res.status(200).json({
       accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });

  } catch (error) {
    logSecurityEvent('error', 'Token Operation - Error', {
      action: 'operation_failed',
      userId: 'unknown',
      deviceId: 'unknown',
      ...extractRequestMetadata(req),
      details: { errorClass: error instanceof Error ? error.name : 'UnknownError' }
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
    const normalizedRefreshToken = boundedString(refreshToken, 4096);
    const normalizedDeviceId = boundedString(deviceId, 256);
    if (!normalizedRefreshToken) {
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

    logger.debug('[Token Revoke] Revoking token');

    // Hash the refresh token
    const hashedToken = hashRefreshToken(normalizedRefreshToken);

    // Delete the token from database
    await storage.deleteRefreshToken(hashedToken);

    logSecurityEvent('info', 'Token Revoke - Success', {
      action: 'token_revoked',
      userId: 'unknown',
      deviceId: normalizedDeviceId || 'unknown',
      ...extractRequestMetadata(req)
    });

    return res.status(200).json({ 
      message: 'Token revoked successfully' 
    });

  } catch (error) {
    logSecurityEvent('error', 'Token Operation - Error', {
      action: 'operation_failed',
      userId: 'unknown',
      deviceId: 'unknown',
      ...extractRequestMetadata(req),
      details: { errorClass: error instanceof Error ? error.name : 'UnknownError' }
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
router.post('/revoke-all', requireAuthJWT, async (req, res) => {
  try {
    // Get userId from authenticated session instead of request body
    const userId = req.user!.id;

    logger.debug('[Token Revoke All] Revoking all tokens for authenticated user');

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
      details: { errorClass: error instanceof Error ? error.name : 'UnknownError' }
    });
    return res.status(500).json({ 
      message: 'Failed to revoke all tokens'
    });
  }
});

export default router;
