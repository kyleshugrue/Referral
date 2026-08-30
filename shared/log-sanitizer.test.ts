import { describe, expect, it } from 'vitest';
import { sanitizeLogValue, scrubSensitiveText } from './log-sanitizer';

describe('log sanitizer', () => {
  it('scrubs cloud signed URL credentials and stack values', () => {
    const signedUrl = 'https://storage.googleapis.com/file?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=secret&Expires=123';
    expect(scrubSensitiveText(signedUrl)).toContain('X-Goog-Signature=[REDACTED]');
    expect(scrubSensitiveText(signedUrl)).toContain('Expires=[REDACTED]');

    const sanitized = sanitizeLogValue({
      url: signedUrl,
      stack: '/workspace/server/index.ts:10',
      safeCount: 2,
    }) as Record<string, unknown>;
    expect(sanitized.url).toBe('[REDACTED]');
    expect(sanitized.stack).toBe('[REDACTED]');
    expect(sanitized.safeCount).toBe(2);
  });
});