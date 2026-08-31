import { logger } from './logger';

/**
 * Validate required environment variables at startup.
 *
 * In production the process refuses to start without its core secrets so a
 * misconfigured deployment fails fast instead of serving broken auth.
 * In development we only warn, to keep local setup friction low.
 */
export function assertRequiredEnv(isProduction: boolean, env: NodeJS.ProcessEnv = process.env): void {
  const missing: string[] = [];

  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (isProduction) {
    if (!env.FIREBASE_PROJECT_ID?.trim()) missing.push('FIREBASE_PROJECT_ID');
    if (!env.FIREBASE_CLIENT_EMAIL?.trim()) missing.push('FIREBASE_CLIENT_EMAIL');
    if (!env.FIREBASE_PRIVATE_KEY?.trim()) missing.push('FIREBASE_PRIVATE_KEY');
  }

  if (missing.length > 0) {
    const message = `Missing required environment variable(s): ${missing.join(', ')}`;
    if (isProduction) {
      throw new Error(`${message}. Refusing to start in production.`);
    }
    logger.warn(`[Startup] ${message} — continuing because NODE_ENV is not production.`);
  }

  if (isProduction && env.FIREBASE_PRIVATE_KEY) {
    const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const beginMarker = ['-----BEGIN', ' PRIVATE KEY-----'].join('');
    const endMarker = ['-----END', ' PRIVATE KEY-----'].join('');
    const hasBeginMarker = privateKey.includes(beginMarker);
    const hasEndMarker = privateKey.includes(endMarker);
    if (!hasBeginMarker || !hasEndMarker) {
      throw new Error('FIREBASE_PRIVATE_KEY has an invalid format. Refusing to start in production.');
    }
  }

  if (!env.INTERNAL_API_SECRET) {
    logger.warn(
      '[Startup] INTERNAL_API_SECRET is not set — internal Worker VM callback endpoints will reject all requests.'
    );
  }
}
