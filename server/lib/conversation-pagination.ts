export const DEFAULT_CONVERSATION_PAGE_SIZE = 25;
export const MAX_CONVERSATION_PAGE_SIZE = 50;

export type ConversationCursor = {
  lastMessageAt: string;
  conversationId: number;
};

export type ConversationPageOptions = {
  limit?: number;
  cursor?: ConversationCursor;
};

export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeConversationCursor(value: unknown): ConversationCursor | undefined {
  if (typeof value !== "string" || value.length > 200) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ConversationCursor>;
    const conversationId = parsed.conversationId;
    if (
      typeof parsed.lastMessageAt !== "string" ||
      !Number.isInteger(conversationId) ||
      (conversationId ?? 0) < 1 ||
      Number.isNaN(Date.parse(parsed.lastMessageAt))
    ) {
      return undefined;
    }
    return { lastMessageAt: parsed.lastMessageAt, conversationId: conversationId as number };
  } catch {
    return undefined;
  }
}

export function normalizeConversationPageOptions(options?: ConversationPageOptions): Required<Pick<ConversationPageOptions, "limit">> & ConversationPageOptions {
  const limit = options?.limit ?? DEFAULT_CONVERSATION_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONVERSATION_PAGE_SIZE) {
    throw new Error(`limit must be an integer between 1 and ${MAX_CONVERSATION_PAGE_SIZE}`);
  }
  return { ...options, limit };
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}