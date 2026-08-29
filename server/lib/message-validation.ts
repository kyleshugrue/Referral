import { z } from 'zod';

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

  return { ok: true, content: content.trim() };
}

/** Validation schema for the group-message creation endpoint. */
export const groupMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
  memberIds: z.array(z.number()).min(1, 'At least one member must be selected'),
});
