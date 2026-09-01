/**
 * DUAL-MODE AUTHENTICATION MIDDLEWARE
 * 
 * Supports both JWT (Authorization Bearer) and session-based authentication
 * during the migration period from session-only to JWT-enabled authentication.
 * 
 * Authentication Flow:
 * 1. Check Authorization header for JWT token (mobile apps)
 * 2. Use session authentication only when no Bearer credential is supplied
 * 3. Reject if neither method succeeds
 * 
 * Usage:
 * Apply this middleware to routes that need to support both mobile (JWT)
 * and web (session) authentication during the migration period.
 * 
 * Example:
 * router.get('/api/user', requireAuthJWT, async (req, res) => {
 *   const user = req.user!;
 *   // ...
 * });
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt-service';
import { storage } from '../storage';
import { logger } from '../lib/logger';
import { logSecurityEvent, extractRequestMetadata } from '../lib/security-logger';
import { requireTrustedOriginForSessionMutation } from '../lib/http-security';

type AuthRequest = Request & {
  id?: string;
  authMethod?: 'jwt' | 'session';
  session: Request['session'] & { userId?: number; passport?: { user?: number } };
};

/**
 * Dual-mode authentication middleware
 * Supports both JWT (Authorization Bearer header) and session-based authentication
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 * 
 * Security Flow:
 * 1. Check for JWT token in Authorization header
 * 2. If JWT is valid, fetch user from database and attach to req.user
 * 3. If no Bearer header is present, use session authentication
 * 4. If neither method succeeds, return 401 Unauthorized
 */
export async function requireAuthJWT(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authRequest = req as AuthRequest;
  const requestId = authRequest.id || 'unknown';
  const requestPath = req.path;
  const requestMethod = req.method;

  // AUTHENTICATION METHOD 1: JWT Token (Authorization Bearer header)
  // This is the primary method for mobile apps
  const authHeader = req.headers.authorization;
  
  const hasBearerHeader = typeof authHeader === 'string' && /^Bearer\s+/i.test(authHeader);
  if (hasBearerHeader) {
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    logger.debug(
      `[Auth:JWT] [ReqID: ${requestId}] Attempting JWT authentication for ${requestMethod} ${requestPath}`
    );

    try {
      // Verify the JWT token
      const payload = verifyAccessToken(token);
      
      if (payload && payload.userId) {
        // Token is valid, fetch user from database
        try {
          const user = await storage.getUser(payload.userId);
          
          if (user) {
            // SUCCESS: JWT authentication successful
            // Attach user to request object for downstream handlers
            req.user = user;
            // Set explicit flag for downstream middleware to verify JWT auth occurred
            authRequest.authMethod = 'jwt';
            
            logger.debug('[JWT Auth] Valid token for user:', user.id);
            logger.debug(
              `[Auth:JWT] [ReqID: ${requestId}] ✅ JWT authentication successful ` +
              `for user ${user.id} accessing ${requestMethod} ${requestPath}`
            );
            
             requireTrustedOriginForSessionMutation(req, res, next);
             return;
          } else {
            // JWT is valid but user not found in database
            logger.warn(
              `[Auth:JWT] [ReqID: ${requestId}] JWT valid but user ${payload.userId} ` +
              `not found in database for ${requestMethod} ${requestPath}`
            );
          }
        } catch (dbError) {
          // Database error while fetching user
          logger.error(
            `[Auth:JWT] [ReqID: ${requestId}] Database error fetching authenticated user`,
            { errorClass: dbError instanceof Error ? dbError.name : 'UnknownError' }
          );
        }
      } else {
        // Token verification failed (invalid or expired)
        logger.debug(
          `[Auth:JWT] [ReqID: ${requestId}] JWT verification failed for ${requestMethod} ${requestPath}`
        );
      }
    } catch (jwtError) {
      // JWT verification threw an error
      logSecurityEvent('error', 'JWT Auth - Invalid Token', {
        action: 'auth_failed',
        userId: 'unknown',
        ...extractRequestMetadata(req),
        details: {
          errorClass: jwtError instanceof Error ? jwtError.name : 'UnknownError',
          path: requestPath,
        }
      });
      logger.debug(
        `[Auth:JWT] [ReqID: ${requestId}] JWT verification error for ${requestMethod} ${requestPath}`,
        { errorClass: jwtError instanceof Error ? jwtError.name : 'UnknownError' }
      );
    }
    
    // A supplied Bearer credential is an explicit authentication choice. Do
    // not let a stale/invalid mobile token fall through to a different user's
    // browser session on the same request.
    logger.debug(
      `[Auth:JWT] [ReqID: ${requestId}] JWT authentication failed; rejecting request`
    );
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // AUTHENTICATION METHOD 2: Session-based authentication (Passport)
  // This is the fallback method for web browsers and when JWT fails
  
  // DETAILED LOGGING: Capture all auth-relevant state for debugging PATCH failures
  const hasSession = !!req.session;
  const hasSessionUser = !!authRequest.session?.userId || !!authRequest.session?.passport?.user;
  const hasCookieHeader = !!req.headers.cookie;
  const isAuthenticated = req.isAuthenticated?.() ?? false;
  const hasReqUser = !!req.user;
  logger.debug(
    `[Auth:JWT] [ReqID: ${requestId}] Session auth check for ${requestMethod} ${requestPath}: ` +
    `{ hasSession: ${hasSession}, hasSessionUser: ${hasSessionUser}, hasCookieHeader: ${hasCookieHeader}, ` +
    `isAuthenticated: ${isAuthenticated}, hasReqUser: ${hasReqUser} }`
  );
  
  if (isAuthenticated && req.user) {
    // SUCCESS: Session authentication successful
    // Set explicit flag for downstream middleware to verify session auth occurred
    authRequest.authMethod = 'session';
    
    logger.debug(
      `[Auth:JWT] [ReqID: ${requestId}] ✅ Session authentication successful ` +
      `for user ${req.user.id} accessing ${requestMethod} ${requestPath}`
    );
    
     requireTrustedOriginForSessionMutation(req, res, next);
     return;
  }

  // AUTHENTICATION FAILED: Neither JWT nor session authentication succeeded
  // Log detailed diagnostics for failed PATCH requests specifically
  if (requestMethod === 'PATCH') {
    logger.error(
      `[Auth:JWT] [ReqID: ${requestId}] PATCH authentication rejected`,
      {
        path: requestPath,
        hasSession,
        hasSessionUser,
        hasCookieHeader,
        isAuthenticated,
        hasReqUser,
      }
    );
  }
  
  logSecurityEvent('warn', 'JWT Auth - Missing Token', {
    action: 'auth_failed',
    userId: 'unknown',
    ...extractRequestMetadata(req),
    details: { path: requestPath }
  });
  logger.warn(
    `[Auth:JWT] [ReqID: ${requestId}] ❌ BLOCKED - No valid authentication ` +
    `for ${requestMethod} ${requestPath} (no valid JWT or session)`
  );

  res.status(401).json({
    error: 'Authentication required',
    message: 'You must be authenticated to access this resource. Please provide a valid JWT token or log in.'
  });
}
