import rateLimit from 'express-rate-limit';

/**
 * Rate limiters for sensitive endpoints.
 *
 * `trust proxy` is pinned to Replit's proxy infrastructure (loopback +
 * private ranges — see server/auth.ts), so req.ip resolves to the real
 * client IP and cannot be spoofed via X-Forwarded-For. Because the setting
 * is no longer the permissive `true`, express-rate-limit's built-in
 * validations stay enabled and will surface any future misconfiguration.
 *
 * Limits are per-IP and intentionally generous enough for legitimate use
 * (multi-step registration, iOS retries) while stopping brute force and
 * abuse loops.
 */

const jsonMessage = (message: string) => ({
  message,
});

/** Login/token endpoints: 30 attempts per 5 minutes per IP. */
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many authentication attempts. Please try again in a few minutes.'),
});

/** Token refresh: higher ceiling — iOS clients refresh periodically. */
export const tokenRefreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many token requests. Please try again in a few minutes.'),
});

/** Registration: 30 requests per hour per IP (registration is multi-step). */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many registration attempts. Please try again later.'),
});

/** Password reset: 5 requests per 15 minutes per IP. */
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many password reset requests. Please try again later.'),
});

/** File uploads: 30 per hour per IP. */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many uploads. Please try again later.'),
});

/** Internal Worker VM endpoints: 120 per minute (bearer secret is the real gate). */
export const internalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many requests.'),
});
