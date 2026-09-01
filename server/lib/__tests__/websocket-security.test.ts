import { describe, expect, it } from 'vitest';
import {
  createWebSocketMessageGuard,
  createWebSocketAdmissionGuard,
  MAX_WEBSOCKET_ADMISSIONS_PER_WINDOW,
  decideWebSocketVerification,
  MAX_WEBSOCKET_MESSAGES_PER_WINDOW,
  MAX_WEBSOCKET_PAYLOAD_BYTES,
} from '../websocket-security';
import { messageSchema } from '../websocket-message-schema';

describe('decideWebSocketVerification', () => {
  it('allows only a successful database user lookup', () => {
    expect(decideWebSocketVerification({ id: 1 })).toEqual({ allowed: true });
    expect(decideWebSocketVerification(undefined)).toEqual({
      allowed: false, statusCode: 401, reason: 'Unauthorized - User not found',
    });
  });

  it('fails closed for database failures and timeouts', () => {
    expect(decideWebSocketVerification(undefined, new Error('timeout'))).toEqual({
      allowed: false, statusCode: 503, reason: 'Authentication verification unavailable',
    });
    expect(decideWebSocketVerification({ id: 1 }, new Error('database unavailable'))).toMatchObject({
      allowed: false, statusCode: 503,
    });
  });
});

describe('createWebSocketMessageGuard', () => {
  it('rejects oversized frames', () => {
    const guard = createWebSocketMessageGuard();
    expect(guard.allow(MAX_WEBSOCKET_PAYLOAD_BYTES + 1)).toMatchObject({
      allowed: false, closeCode: 1009,
    });
  });

  it('rate limits one connection within its window', () => {
    let time = 1_000;
    const guard = createWebSocketMessageGuard(() => time);
    for (let index = 0; index < MAX_WEBSOCKET_MESSAGES_PER_WINDOW; index++) {
      expect(guard.allow(10)).toEqual({ allowed: true });
    }
    expect(guard.allow(10)).toMatchObject({ allowed: false, closeCode: 1013 });
    time += 10_001;
    expect(guard.allow(10)).toEqual({ allowed: true });
  });
});

describe('createWebSocketAdmissionGuard', () => {
  it('limits repeated connection attempts by source address', () => {
    let time = 1_000;
    const guard = createWebSocketAdmissionGuard(() => time);
    for (let index = 0; index < MAX_WEBSOCKET_ADMISSIONS_PER_WINDOW; index++) {
      expect(guard.allow('127.0.0.1')).toBe(true);
    }
    expect(guard.allow('127.0.0.1')).toBe(false);
    expect(guard.allow('127.0.0.2')).toBe(true);
    time += 60_001;
    expect(guard.allow('127.0.0.1')).toBe(true);
  });
});

describe('WebSocket chat schema', () => {
  it('bounds chat content while leaving normal messages valid', () => {
    expect(messageSchema.safeParse({ type: 'chat', receiverId: 2, content: 'hello' }).success).toBe(true);
    expect(messageSchema.safeParse({
      type: 'chat', receiverId: 2, content: 'x'.repeat(4_001),
    }).success).toBe(false);
  });

  it('rejects server-only event types and unknown fields from clients', () => {
    expect(messageSchema.safeParse({ type: 'matchesUpdated' }).success).toBe(false);
    expect(messageSchema.safeParse({ type: 'test', unexpected: true }).success).toBe(false);
  });

  it('requires bounded ISO timestamps when supplied', () => {
    expect(messageSchema.safeParse({ type: 'test', timestamp: 'not-a-date' }).success).toBe(false);
    expect(messageSchema.safeParse({ type: 'test', timestamp: new Date().toISOString() }).success).toBe(true);
  });
});