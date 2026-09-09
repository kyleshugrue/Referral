import type { ExtendedMessage } from '@/types/message';

export interface MessagePage {
  messages: ExtendedMessage[];
  hasMore: boolean;
  nextCursor?: string;
}

export const EMPTY_MESSAGE_PAGE: MessagePage = {
  messages: [],
  hasMore: false,
};

export function mergeMessages<T extends { id: number; createdAt: string; isTemporary?: boolean }>(
  existing: T[],
  incoming: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const message of [...existing, ...incoming]) {
    const key = `${message.isTemporary ? 'temporary' : 'persistent'}:${message.id}`;
    byId.set(key, message);
  }
  return [...byId.values()].sort((left, right) => {
    const createdAt = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return createdAt || Number(left.id) - Number(right.id);
  });
}

export function updateMessagePage(
  page: MessagePage | undefined,
  messages: ExtendedMessage[],
): MessagePage {
  return {
    ...(page ?? EMPTY_MESSAGE_PAGE),
    messages,
  };
}