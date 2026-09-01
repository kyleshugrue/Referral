/**
 * Small, dependency-free WebSocket admission and input controls. Keeping these
 * decisions pure makes the security boundary straightforward to test.
 */
export const MAX_WEBSOCKET_PAYLOAD_BYTES = 64 * 1024;
export const MAX_WEBSOCKET_CHAT_CONTENT_LENGTH = 4_000;
export const MAX_WEBSOCKET_MESSAGES_PER_WINDOW = 60;
export const WEBSOCKET_RATE_WINDOW_MS = 10_000;
export const MAX_WEBSOCKET_ADMISSIONS_PER_WINDOW = 30;
export const WEBSOCKET_ADMISSION_WINDOW_MS = 60_000;

export type WebSocketVerificationDecision =
  | { allowed: true }
  | { allowed: false; statusCode: number; reason: string };

/** Database verification is an authorization dependency, so failures deny access. */
export function decideWebSocketVerification(
  user: unknown,
  verificationError?: unknown,
): WebSocketVerificationDecision {
  if (verificationError) {
    return { allowed: false, statusCode: 503, reason: 'Authentication verification unavailable' };
  }
  if (!user) {
    return { allowed: false, statusCode: 401, reason: 'Unauthorized - User not found' };
  }
  return { allowed: true };
}

/**
 * Per-connection sliding-window guard. It is intentionally independent of ws
 * so tests and future transports can exercise the same limits.
 */
export function createWebSocketMessageGuard(
  now: () => number = Date.now,
) {
  let messages: number[] = [];

  return {
    allow(payloadBytes: number): { allowed: boolean; closeCode?: number; reason?: string } {
      if (!Number.isFinite(payloadBytes) || payloadBytes < 0 || payloadBytes > MAX_WEBSOCKET_PAYLOAD_BYTES) {
        return { allowed: false, closeCode: 1009, reason: 'Message too large' };
      }

      const cutoff = now() - WEBSOCKET_RATE_WINDOW_MS;
      messages = messages.filter((timestamp) => timestamp > cutoff);
      if (messages.length >= MAX_WEBSOCKET_MESSAGES_PER_WINDOW) {
        return { allowed: false, closeCode: 1013, reason: 'Too many messages' };
      }
      messages.push(now());
      return { allowed: true };
    },
  };
}

/**
 * Process-local admission guard for the documented single-instance topology.
 * It runs before database-backed authentication so reconnect storms cannot
 * consume the authentication/query budget.
 */
export function createWebSocketAdmissionGuard(now: () => number = Date.now) {
  const attempts = new Map<string, number[]>();

  return {
    allow(address: string): boolean {
      const current = now();
      const recent = (attempts.get(address) || []).filter(
        (timestamp) => current - timestamp < WEBSOCKET_ADMISSION_WINDOW_MS,
      );
      if (recent.length >= MAX_WEBSOCKET_ADMISSIONS_PER_WINDOW) {
        attempts.set(address, recent);
        return false;
      }
      recent.push(current);
      attempts.set(address, recent);
      return true;
    },
  };
}