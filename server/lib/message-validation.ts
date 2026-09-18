/**
 * Pure validation for the direct-message creation endpoint. No DB/network
 * access, so it can be unit tested with plain inputs.
 */
export type DirectMessageValidation =
  | { ok: true; content: string }
  | { ok: false; message: string };

export const MESSAGE_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export function isValidMessageIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= MESSAGE_IDEMPOTENCY_KEY_MAX_LENGTH
    && value === value.trim()
    && /^[\x21-\x7e]+$/.test(value);
}

export function validateMessageIdempotencyKey(value: unknown): { ok: true; key: string } | { ok: false; message: string } {
  if (!isValidMessageIdempotencyKey(value)) {
    return {
      ok: false,
      message: `Idempotency-Key must contain 1-${MESSAGE_IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters`,
    };
  }
  return { ok: true, key: value };
}

export function validateDirectMessageInput(
  receiverId: number,
  content: unknown
): DirectMessageValidation {
  if (!receiverId || Number.isNaN(receiverId)) {
    return { ok: false, message: 'Invalid receiver ID' };
  }

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, message: 'Message content is required' };
  }

  const normalizedContent = content.trim();
  if (normalizedContent.length > 4_000) {
    return { ok: false, message: 'Message content is too long' };
  }

  return { ok: true, content: normalizedContent };
}
