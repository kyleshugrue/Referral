import type { Request, Response, NextFunction } from 'express';

function isTrustedProxyAddress(address: string): boolean {
  const normalized = address.trim().replace(/^::ffff:/i, '');
  if (normalized === '::1' || normalized.startsWith('127.')) return true;
  if (normalized.startsWith('10.') || normalized.startsWith('192.168.')) return true;
  const octets = normalized.split('.').map(Number);
  if (octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return /^(fc|fd|fe8|fe9|fea|feb)/i.test(normalized);
}

/**
 * Resolve the client address for HTTP upgrades. Express's trust-proxy
 * configuration does not run for ws verifyClient, so apply the same
 * right-to-left private-hop rule explicitly.
 */
export function getTrustedClientIp(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
): string {
  const socketAddress = remoteAddress?.trim() || 'unknown';
  if (!isTrustedProxyAddress(socketAddress)) return socketAddress;
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (let index = chain.length - 1; index >= 0; index--) {
    if (!isTrustedProxyAddress(chain[index])) return chain[index];
  }
  return chain[0] || socketAddress;
}

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
 * - X-Frame-Options / HSTS / CSP: production only, because the Replit development
 *   preview renders the app inside an iframe over a proxy.
 *
 * The policy permits the app's known Firebase/Google integrations while
 * explicitly disallowing eval, plugin
 * content, and framing by other origins. Keep this list synchronized with the
 * client resource inventory when integrations change.
 */
export function securityHeaders(isProduction: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    if (isProduction) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'self'",
           "script-src 'self' https://apis.google.com https://www.gstatic.com https://www.googletagmanager.com https://maps.googleapis.com",
          "style-src 'self'",
           "connect-src 'self' https://*.googleapis.com https://*.google.com https://*.firebaseio.com https://www.google-analytics.com https://analytics.google.com",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data: https:",
          "worker-src 'self' blob:",
          "manifest-src 'self'",
          "form-action 'self'",
        ].join('; '),
      );
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self "capacitor://localhost" "ionic://localhost")');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    }
    next();
  };
}
