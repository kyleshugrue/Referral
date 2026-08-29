import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import { logger } from './logger';

/**
 * JWT Token Service
 * Handles generation, verification, and validation of JWT access tokens and refresh tokens
 * 
 * Architecture:
 * - Access tokens: Short-lived (15min) JWT tokens for API authentication
 * - Refresh tokens: Long-lived (30day) opaque tokens stored hashed in database
 * - Device-bound: Each device has its own refresh token for better security
 */

interface AccessTokenPayload {
  userId: number;
  email: string;
  type: 'access';
}

interface DeviceInfo {
  ip?: string;
  userAgent?: string;
  platform?: string;
  deviceModel?: string;
  osVersion?: string;
  timestamp?: string;
}

// Token expiry durations
const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const REFRESH_TOKEN_EXPIRY_DAYS = 30; // 30 days
const REFRESH_TOKEN_EXPIRY_MS = REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

/**
 * Generate a signed JWT access token
 * @param userId - User's database ID
 * @param email - User's email address
 * @returns Signed JWT access token (15 minute expiry)
 */
export function generateAccessToken(userId: number, email: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  const payload: AccessTokenPayload = {
    userId,
    email,
    type: 'access'
  };

  return jwt.sign(payload, secret, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: 'referral-auth',
    audience: 'referral-api'
  });
}

/**
 * Verify and decode a JWT access token
 * @param token - JWT access token to verify
 * @returns Decoded token payload or null if invalid
 */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[JWT-Service] JWT_SECRET environment variable is not set!');
    throw new Error('JWT_SECRET environment variable is not set');
  }

  try {
    const decoded = jwt.verify(token, secret, {
      issuer: 'referral-auth',
      audience: 'referral-api'
    }) as AccessTokenPayload;

    // Validate token type
    if (decoded.type !== 'access') {
      logger.warn('[JWT-Service] Token type mismatch - expected "access", got:', decoded.type);
      return null;
    }

    logger.debug('[JWT-Service] ✅ Token verified successfully for user:', decoded.userId);
    return decoded;
  } catch (error) {
    // Detailed error logging for debugging - never log any part of the raw token
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn(`[JWT-Service] Token expired at ${error.expiredAt}`);
    } else if (error instanceof jwt.JsonWebTokenError) {
      logger.warn(`[JWT-Service] JWT Error: ${error.message}`);
    } else if (error instanceof jwt.NotBeforeError) {
      logger.warn(`[JWT-Service] Token not yet valid (nbf): ${error.date}`);
    } else {
      logger.error(`[JWT-Service] Unexpected verification error:`, error);
    }
    
    return null;
  }
}

/**
 * Generate a cryptographically secure opaque refresh token
 * @returns Random 64-character hex string
 */
export function generateRefreshToken(): string {
  // Generate 32 bytes (256 bits) of random data
  // Convert to hex string (64 characters)
  return randomBytes(32).toString('hex');
}

/**
 * Hash a refresh token for secure storage
 * Uses SHA-256 to create a one-way hash of the token
 * @param token - Plain refresh token
 * @returns SHA-256 hash of the token
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Calculate expiry date for a refresh token
 * @returns ISO timestamp 30 days from now
 */
export function getRefreshTokenExpiry(): string {
  const expiryDate = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
  return expiryDate.toISOString();
}

/**
 * Create device info JSON string from request metadata
 * @param ip - Client IP address
 * @param userAgent - Client user agent string
 * @param platform - Platform identifier (ios-native, web, android-native)
 * @returns JSON string with device metadata
 */
export function createDeviceInfo(
  ip: string | undefined,
  userAgent: string | undefined,
  platform: string | undefined,
  deviceModel?: string,
  osVersion?: string
): string {
  const deviceInfo: DeviceInfo = {
    ip: ip || 'unknown',
    userAgent: userAgent || 'unknown',
    platform: platform || 'unknown',
    deviceModel,
    osVersion,
    timestamp: new Date().toISOString()
  };

  return JSON.stringify(deviceInfo);
}

/**
 * Parse device info JSON string
 * @param deviceInfoJson - JSON string with device metadata
 * @returns Parsed device info object
 */
export function parseDeviceInfo(deviceInfoJson: string): DeviceInfo {
  try {
    return JSON.parse(deviceInfoJson);
  } catch {
    return { ip: 'unknown', userAgent: 'unknown', platform: 'unknown' };
  }
}

/**
 * Check if a refresh token is expired
 * @param expiresAt - ISO timestamp of token expiry
 * @returns true if token is expired
 */
export function isRefreshTokenExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

/**
 * Get token expiry information for client use
 * @returns Object with access token expiry in milliseconds
 */
export function getTokenExpiryInfo() {
  return {
    accessTokenExpiryMs: 15 * 60 * 1000, // 15 minutes in milliseconds
    refreshTokenExpiryMs: REFRESH_TOKEN_EXPIRY_MS, // 30 days in milliseconds
  };
}
