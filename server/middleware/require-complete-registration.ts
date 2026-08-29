/**
 * SECURITY MIDDLEWARE: Registration Completion Enforcement
 * 
 * This is the PRIMARY DEFENSE against registration bypass attacks.
 * 
 * Purpose:
 * - Enforces that users must complete their registration before accessing protected resources
 * - Prevents unauthorized access to sensitive API endpoints (matches, connections, messages, profiles)
 * - Acts as a critical security layer that cannot be bypassed from the client side
 * 
 * Security Features:
 * - Server-side validation only (client-side checks can be bypassed)
 * - Comprehensive audit logging for security monitoring
 * - Clear error responses for debugging and UX
 * - Fail-secure design (denies access on any error or missing data)
 * 
 * Usage:
 * Apply this middleware to all protected API routes that require a fully registered user.
 * Example: router.use('/api/matches', requireCompleteRegistration, matchesRouter);
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

/**
 * Middleware function that enforces registration completion
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 * 
 * Security Flow:
 * 1. Verify user authentication (401 if not authenticated)
 * 2. Verify registration completion (403 if incomplete)
 * 3. Allow access if both checks pass
 */
export function requireCompleteRegistration(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = (req as Request & { id?: string }).id || 'unknown';
  const requestPath = req.path;
  const requestMethod = req.method;

  // SECURITY CHECK 1: Authentication
  // Verify that the user is authenticated via either:
  // 1. Passport session (web browsers) - req.isAuthenticated() returns true
  // 2. JWT authentication (iOS native) - requireAuthJWT middleware sets req.authMethod = 'jwt'
  // 
  // SECURITY: We check for the explicit authMethod flag set by requireAuthJWT middleware
  // rather than just checking req.user, which prevents auth bypass if req.user is
  // populated through other means (e.g., Passport deserialize without valid session).
  const authMethod = (req as Request & { authMethod?: 'jwt' | 'session' }).authMethod;
  const isAuthenticated = req.isAuthenticated() || authMethod === 'jwt' || authMethod === 'session';
  
  if (!isAuthenticated) {
    logger.warn('[Security:RegistrationGuard] Blocked unauthenticated access', {
      requestId,
      method: requestMethod,
      path: requestPath,
    });
    
    res.status(401).json({
      error: 'Authentication required',
      message: 'You must be logged in to access this resource'
    });
    return;
  }

  // Get authenticated user (from Passport session or JWT middleware)
  const user = req.user;

  // SECURITY CHECK 2: User Object Validation
  // Ensure user object exists and has required fields
  if (!user || typeof user.id !== 'number') {
    logger.error('[Security:RegistrationGuard] Blocked invalid authentication state', {
      requestId,
      method: requestMethod,
      path: requestPath,
    });
    
    res.status(401).json({
      error: 'Invalid authentication state',
      message: 'Authentication required'
    });
    return;
  }

  // SECURITY CHECK 3: Registration Completion Status
  // This is the PRIMARY DEFENSE against registration bypass attacks
  // The registrationCompleted flag must be explicitly true
  if (user.registrationCompleted !== true) {
    logger.warn('[Security:RegistrationGuard] Blocked incomplete registration', {
      requestId,
      method: requestMethod,
      path: requestPath,
      userId: user.id,
      registrationCompleted: user.registrationCompleted,
    });
    
    res.status(403).json({
      error: 'Registration incomplete',
      message: 'Registration incomplete. Please complete your profile setup.',
      requiresAction: 'complete_registration'
    });
    return;
  }

  // ALL SECURITY CHECKS PASSED
  // Log successful validation for audit trail
  logger.debug('[Security:RegistrationGuard] Registration check passed', {
    requestId,
    method: requestMethod,
    path: requestPath,
    userId: user.id,
  });

  // Allow request to proceed
  next();
}

/**
 * Type guard to check if a user has completed registration
 * Useful for additional checks in route handlers
 */
export function isRegistrationComplete(user: Express.User | undefined): boolean {
  return user !== undefined && user.registrationCompleted === true;
}
