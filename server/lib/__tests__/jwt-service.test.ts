import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-for-jwt-service-spec';
});

afterAll(() => {
  process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
});

// Imported after JWT_SECRET is guaranteed to be set, matching how the real
// module reads it lazily inside each function (not at module load time).
import { generateAccessToken, verifyAccessToken, isRefreshTokenExpired, parseDeviceInfo } from '../jwt-service';

describe('auth failure handling (representative)', () => {
  it('rejects a token signed with the wrong secret', () => {
    const forged = jwt.sign({ userId: 1, email: 'a@b.com', type: 'access' }, 'wrong-secret', {
      issuer: 'referral-auth',
      audience: 'referral-api',
      expiresIn: '15m',
    });
    expect(verifyAccessToken(forged)).toBeNull();
  });

  it('rejects a malformed token string', () => {
    expect(verifyAccessToken('not-a-real-jwt')).toBeNull();
  });

  it('rejects a token whose type claim is not "access"', () => {
    const wrongType = jwt.sign(
      { userId: 1, email: 'a@b.com', type: 'refresh' },
      process.env.JWT_SECRET as string,
      { issuer: 'referral-auth', audience: 'referral-api', expiresIn: '15m' }
    );
    expect(verifyAccessToken(wrongType)).toBeNull();
  });

  it('accepts a validly-signed access token', () => {
    const token = generateAccessToken(7, 'user@example.com');
    const decoded = verifyAccessToken(token);
    expect(decoded).toMatchObject({ userId: 7, email: 'user@example.com', type: 'access' });
  });
});

describe('expired-session handling (representative)', () => {
  it('rejects an access token that has already expired', () => {
    const expired = jwt.sign(
      { userId: 1, email: 'a@b.com', type: 'access' },
      process.env.JWT_SECRET as string,
      { issuer: 'referral-auth', audience: 'referral-api', expiresIn: -10 }
    );
    expect(verifyAccessToken(expired)).toBeNull();
  });

  it('flags a refresh token expiry timestamp in the past as expired', () => {
    expect(isRefreshTokenExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
  });

  it('does not flag a future refresh token expiry as expired', () => {
    expect(isRefreshTokenExpired(new Date(Date.now() + 1000 * 60 * 60).toISOString())).toBe(false);
  });
});

describe('API error-handling (representative): malformed device info never crashes', () => {
  it('falls back to safe defaults instead of throwing on invalid JSON', () => {
    expect(() => parseDeviceInfo('{not valid json')).not.toThrow();
    expect(parseDeviceInfo('{not valid json')).toEqual({
      ip: 'unknown',
      userAgent: 'unknown',
      platform: 'unknown',
    });
  });

  it('parses well-formed device info normally', () => {
    const json = JSON.stringify({ ip: '1.2.3.4', userAgent: 'test-agent', platform: 'web' });
    expect(parseDeviceInfo(json)).toEqual({ ip: '1.2.3.4', userAgent: 'test-agent', platform: 'web' });
  });
});
