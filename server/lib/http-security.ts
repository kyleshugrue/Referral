import type { Request, Response, NextFunction } from 'express';

/**
 * CORS origin policy.
 *
 * Production allows only an exact allowlist:
 *   - Capacitor/Ionic WebView origins used by the iOS app
 *   - The known production web domains
 *   - Extra origins from the ALLOWED_ORIGINS env var (comma-separated)
 *
 * Development additionally allows localhost and Replit preview origins.
 *
 * Requests without an Origin header (native app HTTP clients, curl,
 * server-to-server calls) are always allowed — CORS only governs browsers.
 */

const STATIC_ALLOWED_ORIGINS = [
  'capacitor://localhost',
  'ionic://localhost',
  'https://referral-mobile-app-kylejshugrue.replit.app',
  'https://referralprofessional.net',
  'https://www.referralprofessional.net',
];

export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...STATIC_ALLOWED_ORIGINS, ...extra];
}

export function isOriginAllowed(
  origin: string | undefined,
  isProduction: boolean,
  allowedOrigins: string[] = getAllowedOrigins()
): boolean {
  // No Origin header: not a browser cross-origin request.
  if (!origin) return true;

  if (allowedOrigins.includes(origin)) return true;

  if (!isProduction) {
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
      if (url.hostname.endsWith('.replit.dev')) return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Protect cookie-authenticated unsafe requests from cross-site forgery.
 *
 * Native clients authenticate with a bearer token and do not need an Origin
 * header. Browser sessions, however, must present an Origin that is both
 * present and on the CORS allowlist.
 */
export function requireTrustedOriginForSessionMutation(
  req: Request,
  res: Response,
  next: NextFunction,
) : void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const authMethod = (req as Request & { authMethod?: 'jwt' | 'session' }).authMethod;
  const isCookieAuthenticated = authMethod === 'session' ||
    (!authMethod && (req.isAuthenticated?.() ?? false));

  if (!isCookieAuthenticated) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (!origin || !isOriginAllowed(origin, process.env.NODE_ENV === 'production')) {
    res.status(403).json({ message: 'Request origin not allowed' });
    return;
  }

  next();
}

/**
 * Baseline security headers.
 *
 * - X-Content-Type-Options: prevents MIME sniffing everywhere.
 * - Referrer-Policy: limits referrer leakage.
 * - X-Frame-Options / HSTS: production only, because the Replit development
 *   preview renders the app inside an iframe over a proxy.
 *
 * A Content-Security-Policy is intentionally NOT set: the app loads Firebase,
 * Google APIs, and Vite-injected inline scripts, so a strict CSP would break
 * it. This is documented as a known limitation in SECURITY.md.
 */
export function securityHeaders(isProduction: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (isProduction) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}
