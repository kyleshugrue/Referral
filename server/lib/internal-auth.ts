import { timingSafeEqual } from 'crypto';

/**
 * Verify the bearer secret used by internal endpoints (Worker VM callbacks).
 *
 * Uses a constant-time comparison so the secret cannot be recovered through
 * timing side channels. Returns false when the server has no secret
 * configured — internal endpoints must never be open by default.
 */
export function verifyInternalAuth(
  authHeader: string | undefined,
  expectedSecret: string | undefined
): boolean {
  if (!expectedSecret) return false;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;

  const provided = Buffer.from(authHeader.slice('Bearer '.length));
  const expected = Buffer.from(expectedSecret);

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
