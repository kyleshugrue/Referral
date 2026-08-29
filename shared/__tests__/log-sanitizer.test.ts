import { describe, it, expect } from 'vitest';
import { sanitizeLogValue, sanitizeLogArgs, scrubSensitiveText } from '../log-sanitizer';

describe('log-sanitizer', () => {
  describe('bare string arguments (not object properties)', () => {
    it('redacts a bare email address string', () => {
      const result = sanitizeLogValue('Login successful for user@example.com');
      expect(result).not.toContain('user@example.com');
      expect(result).toContain('[REDACTED_EMAIL]');
    });

    it('redacts a bare JWT-shaped string', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const result = sanitizeLogValue(`Connecting with token ${jwt}`);
      expect(result).not.toContain(jwt);
      expect(result).toContain('[REDACTED_TOKEN]');
    });

    it('strips a sensitive query param from a bare URL string, preserving the rest of the URL', () => {
      const url = 'wss://example.com/ws?token=eyJabc123.def456.ghi789&userId=42';
      const result = sanitizeLogValue(url) as string;
      expect(result).not.toContain('eyJabc123.def456.ghi789');
      expect(result).toContain('wss://example.com/ws');
      expect(result).toContain('userId=42');
    });

    it('leaves ordinary, non-sensitive strings untouched', () => {
      expect(sanitizeLogValue('Server started on port 5000')).toBe('Server started on port 5000');
    });
  });

  describe('object property redaction by key', () => {
    it('redacts values behind exact sensitive key names', () => {
      const result = sanitizeLogValue({
        email: 'user@example.com',
        password: 'hunter2',
        token: 'abc.def.ghi',
        uid: 'firebase-uid-123',
        userId: 42,
      }) as Record<string, unknown>;

      expect(result.email).toBe('[REDACTED]');
      expect(result.password).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.uid).toBe('[REDACTED]');
      expect(result.userId).toBe(42); // non-sensitive key passes through
    });

    it('redacts session-id-shaped keys, including aliases that do not exactly match "sessionId"', () => {
      const result = sanitizeLogValue({
        sessionId: 'sess-abc123',
        originalSessionId: 'sess-abc123',
        newSessionId: 'sess-def456',
        hasSession: true,
      }) as Record<string, unknown>;

      expect(result.sessionId).toBe('[REDACTED]');
      expect(result.originalSessionId).toBe('[REDACTED]');
      expect(result.newSessionId).toBe('[REDACTED]');
      expect(result.hasSession).toBe(true); // boolean flag, not a credential
    });

    it('redacts compound/aliased key names for uid, email, and token without needing an exact-name allowlist entry', () => {
      const result = sanitizeLogValue({
        tokenUid: 'uid-123',
        storedUid: 'uid-456',
        providedUid: 'uid-789',
        emailFromFirebase: 'a@b.com',
        emailInDb: 'c@d.com',
        deviceToken: 'device-token-value',
        fcmToken: 'fcm-token-value',
        userId: 42, // must NOT be treated as sensitive
        requestId: 'req-1', // must NOT be treated as sensitive
      }) as Record<string, unknown>;

      expect(result.tokenUid).toBe('[REDACTED]');
      expect(result.storedUid).toBe('[REDACTED]');
      expect(result.providedUid).toBe('[REDACTED]');
      expect(result.emailFromFirebase).toBe('[REDACTED]');
      expect(result.emailInDb).toBe('[REDACTED]');
      expect(result.deviceToken).toBe('[REDACTED]');
      expect(result.fcmToken).toBe('[REDACTED]');
      expect(result.userId).toBe(42);
      expect(result.requestId).toBe('req-1');
    });

    it('redacts push-notification payload fields carrying another user\'s name or a private message preview', () => {
      const result = sanitizeLogValue({
        type: 'new_message',
        sender_name: 'Jane Doe',
        message_preview: 'Hey, are we still on for lunch tomorrow?',
        accepter_name: 'John Smith',
        fullName: 'Jane Doe',
      }) as Record<string, unknown>;

      expect(result.sender_name).toBe('[REDACTED]');
      expect(result.message_preview).toBe('[REDACTED]');
      expect(result.accepter_name).toBe('[REDACTED]');
      expect(result.fullName).toBe('[REDACTED]');
      expect(result.type).toBe('new_message'); // structural field, safe to keep
    });

    it('redacts sensitive keys inside nested objects and arrays', () => {
      const result = sanitizeLogValue({
        user: { id: 1, email: 'nested@example.com' },
        items: [{ accessToken: 'secret-token' }, { count: 3 }],
      }) as {
        user: { id: number; email: string };
        items: Array<{ accessToken?: string; count?: number }>;
      };

      expect(result.user.email).toBe('[REDACTED]');
      expect(result.user.id).toBe(1);
      expect(result.items[0].accessToken).toBe('[REDACTED]');
      expect(result.items[1].count).toBe(3);
    });

    it('handles circular references without throwing', () => {
      const obj: { name: string; self?: unknown } = { name: 'circular' };
      obj.self = obj;
      expect(() => sanitizeLogValue(obj)).not.toThrow();
    });
  });

  describe('Error handling', () => {
    it('scrubs sensitive patterns embedded in an Error message', () => {
      const error = new Error('Failed to verify token for user@example.com');
      const result = sanitizeLogValue(error) as { name: string; message: string };
      expect(result.name).toBe('Error');
      expect(result.message).not.toContain('user@example.com');
      expect(result.message).toContain('[REDACTED_EMAIL]');
    });
  });

  describe('sanitizeLogArgs', () => {
    it('sanitizes every argument in a log call, mixing bare strings and objects', () => {
      const args = sanitizeLogArgs([
        'Connecting to:',
        'wss://host/ws?token=abcdefghij.klmnopqrst.uvwxyz1234',
        { userId: 1, email: 'a@b.com' },
      ]);

      expect(args[0]).toBe('Connecting to:');
      expect(args[1]).not.toContain('abcdefghij.klmnopqrst.uvwxyz1234');
      const thirdArgument = args[2] as { email: string; userId: number };
      expect(thirdArgument.email).toBe('[REDACTED]');
      expect(thirdArgument.userId).toBe(1);
    });
  });

  describe('scrubSensitiveText', () => {
    it('redacts multiple sensitive query params in the same URL', () => {
      const url = 'https://api.example.com/callback?access_token=xyz123&password=secret&other=fine';
      const result = scrubSensitiveText(url);
      expect(result).not.toContain('xyz123');
      expect(result).not.toContain('secret');
      expect(result).toContain('other=fine');
    });
  });
});
