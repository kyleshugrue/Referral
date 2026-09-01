/**
 * Pure validation for the direct-message creation endpoint. No DB/network
 * access, so it can be unit tested with plain inputs.
 */
export type DirectMessageValidation =
  | { ok: true; content: string }
  | { ok: false; message: string };

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
