import type { Request, Response, NextFunction } from 'express';
import { auth } from './firebase-admin';
import { logger } from './logger';

/**
 * Registration route authentication.
 *
 * Registration endpoints are public (no session exists yet), so the only
 * trustworthy identity is a Firebase ID token issued after the client
 * completed Firebase sign-up. These helpers verify that token server-side
 * and derive the Firebase UID, email, and email-verification status from
 * the decoded token — never from the request body.
 */

export interface VerifiedRegistrant {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

type RegistrantRequest = Request & { registrant?: VerifiedRegistrant };

/** Extract a bearer token from an Authorization header value. */
export function extractBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/** Convert the legacy JSON-body token shape to the normal bearer-token form. */
export function legacyFirebaseTokenAuthorization(token: unknown): string | null {
  if (typeof token !== 'string' || !token.trim()) return null;
  return `Bearer ${token.trim()}`;
}

/**
 * A client may echo its firebaseUid in the body for convenience, but if it
 * does, it must match the UID in the verified token.
 */
export function uidMatchesClaim(decodedUid: string, claimedUid: unknown): boolean {
  if (claimedUid === undefined || claimedUid === null || claimedUid === '') {
    return true;
  }
  return typeof claimedUid === 'string' && claimedUid === decodedUid;
}

/** Build the trusted registrant identity from a decoded Firebase token. */
export function registrantFromDecodedToken(decoded: {
  uid: string;
  email?: string;
  email_verified?: boolean;
}): VerifiedRegistrant {
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    emailVerified: decoded.email_verified === true,
  };
}

export function getRegistrant(req: Request): VerifiedRegistrant {
  const registrant = (req as RegistrantRequest).registrant;
  if (!registrant) {
    // Route misconfiguration — the middleware must run first.
    throw new Error('requireVerifiedFirebaseUser middleware did not run');
  }
  return registrant;
}

/**
 * Express middleware: requires a valid Firebase ID token and attaches the
 * verified identity to the request. Rejects UID spoofing attempts.
 */
export async function requireVerifiedFirebaseUser(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ message: 'Authentication required: missing Firebase ID token' });
  }

  let decoded: { uid?: unknown; email?: string; email_verified?: boolean };
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired Firebase ID token' });
  }

  if (!decoded || typeof decoded.uid !== 'string' || decoded.uid.length === 0) {
    return res.status(401).json({ message: 'Invalid Firebase ID token' });
  }

  if (!uidMatchesClaim(decoded.uid, req.body?.firebaseUid)) {
    logger.warn('[register-auth] Rejected registration with mismatched firebaseUid claim');
    return res.status(403).json({ message: 'Firebase UID does not match authenticated user' });
  }

  (req as RegistrantRequest).registrant = registrantFromDecodedToken(decoded as { uid: string; email?: string; email_verified?: boolean });
  return next();
}
