import { describe, expect, it } from 'vitest';
import {
  decodeMessageCursor,
  encodeMessageCursor,
  MAX_MESSAGE_PAGE_SIZE,
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
});