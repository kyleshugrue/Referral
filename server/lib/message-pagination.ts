import type { Message } from '@shared/schema';

export const DEFAULT_MESSAGE_PAGE_SIZE = 50;
export const MAX_MESSAGE_PAGE_SIZE = 100;

export type MessageCursor = Pick<Message, 'id' | 'createdAt'>;

export function encodeMessageCursor(message: MessageCursor): string {
  return Buffer.from(JSON.stringify({
    id: message.id,
    createdAt: message.createdAt,
  }), 'utf8').toString('base64url');
}

export function decodeMessageCursor(value: unknown): MessageCursor | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!decoded || typeof decoded !== 'object') return undefined;
    const candidate = decoded as Record<string, unknown>;
    if (
      !Number.isSafeInteger(candidate.id) ||
      (candidate.id as number) <= 0 ||
      typeof candidate.createdAt !== 'string' ||
      candidate.createdAt.length === 0 ||
      candidate.createdAt.length > 64 ||
      Number.isNaN(Date.parse(candidate.createdAt))
    ) {
      return undefined;
    }
    return { id: candidate.id as number, createdAt: candidate.createdAt };
  } catch {
    return undefined;
  }
}