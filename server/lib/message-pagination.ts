import type { Message } from '@shared/schema';

export const DEFAULT_MESSAGE_PAGE_SIZE = 50;
export const MAX_MESSAGE_PAGE_SIZE = 100;

export type MessageCursor = Pick<Message, 'id' | 'createdAt'>;

export interface MessagePageWindow<T extends MessageCursor> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string;
}

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

export function isMessageCursorBefore(message: MessageCursor, cursor: MessageCursor): boolean {
  const messageTime = new Date(message.createdAt).getTime();
  const cursorTime = new Date(cursor.createdAt).getTime();
  return messageTime < cursorTime || (messageTime === cursorTime && message.id < cursor.id);
}

/**
 * Page rows already ordered newest-first, returning each bounded page in the
 * chronological order used by chat UIs. The cursor always points at the
 * oldest row returned so the next request can continue strictly earlier.
 */
export function paginateMessages<T extends MessageCursor>(
  newestFirst: T[],
  limit: number,
  cursor?: MessageCursor,
): MessagePageWindow<T> {
  const eligible = cursor ? newestFirst.filter((message) => isMessageCursorBefore(message, cursor)) : newestFirst;
  const window = eligible.slice(0, Math.max(1, Math.trunc(limit)) + 1);
  const hasMore = window.length > limit;
  const page = (hasMore ? window.slice(0, limit) : window).reverse();
  return {
    items: page,
    hasMore,
    ...(hasMore && page.length > 0 ? { nextCursor: encodeMessageCursor(page[0]) } : {}),
  };
}