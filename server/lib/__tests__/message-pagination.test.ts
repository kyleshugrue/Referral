import { describe, expect, it } from 'vitest';
import {
  decodeMessageCursor,
  encodeMessageCursor,
  MAX_MESSAGE_PAGE_SIZE,
  paginateMessages,
} from '../message-pagination';

describe('message cursor contract', () => {
  it('round-trips the stable createdAt/id cursor', () => {
    const cursor = { id: 42, createdAt: '2026-09-02T12:00:00.000Z' };
    expect(decodeMessageCursor(encodeMessageCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed, oversized, and unsafe cursors', () => {
    expect(decodeMessageCursor('not-base64-json')).toBeUndefined();
    expect(decodeMessageCursor(Buffer.from(JSON.stringify({ id: 0, createdAt: 'now' })).toString('base64url'))).toBeUndefined();
    expect(decodeMessageCursor('x'.repeat(257))).toBeUndefined();
    expect(MAX_MESSAGE_PAGE_SIZE).toBe(100);
  });

  it('pages 125 equal-timestamp messages newest-first without gaps or duplicates', () => {
    const rows = Array.from({ length: 125 }, (_, index) => ({
      id: 125 - index,
      createdAt: '2026-09-02T12:00:00.000Z',
    }));
    const pages: number[][] = [];
    let cursor: { id: number; createdAt: string } | undefined;

    for (;;) {
      const page = paginateMessages(rows, 50, cursor);
      pages.unshift(page.items.map((message) => message.id));
      if (!page.nextCursor) break;
      cursor = decodeMessageCursor(page.nextCursor);
      expect(cursor).toBeDefined();
    }

    const seen = pages.flat();
    expect(seen).toEqual(Array.from({ length: 125 }, (_, index) => index + 1));
    expect(new Set(seen).size).toBe(125);
  });
});