import { describe, it, expect } from 'vitest';
import {
  extractBearerToken,
  legacyFirebaseTokenAuthorization,
  uidMatchesClaim,
  registrantFromDecodedToken,
} from '../register-auth';

describe('extractBearerToken', () => {
  it('extracts a token from a Bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme', () => {
    expect(extractBearerToken('bearer token123')).toBe('token123');
  });

  it('trims surrounding whitespace from the token', () => {
    expect(extractBearerToken('Bearer   token123  ')).toBe('token123');
  });

  it('returns null for missing or non-string headers', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken(42)).toBeNull();
  });

  it('returns null for non-Bearer schemes', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });

  it('returns null for a Bearer header without a token', () => {
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer   ')).toBeNull();
  });
});

describe('legacyFirebaseTokenAuthorization', () => {
  it('adapts only a non-empty legacy body token to bearer authentication', () => {
    expect(legacyFirebaseTokenAuthorization(' legacy-token ')).toBe('Bearer legacy-token');
    expect(legacyFirebaseTokenAuthorization('')).toBeNull();
    expect(legacyFirebaseTokenAuthorization({ token: 'nope' })).toBeNull();
  });
});

describe('uidMatchesClaim', () => {
  it('accepts when the body omits firebaseUid', () => {
    expect(uidMatchesClaim('uid-1', undefined)).toBe(true);
    expect(uidMatchesClaim('uid-1', null)).toBe(true);
    expect(uidMatchesClaim('uid-1', '')).toBe(true);
  });

  it('accepts when the claimed uid matches the token uid', () => {
    expect(uidMatchesClaim('uid-1', 'uid-1')).toBe(true);
  });

  it('rejects when the claimed uid differs from the token uid', () => {
    expect(uidMatchesClaim('uid-1', 'uid-2')).toBe(false);
  });

  it('rejects non-string claims', () => {
    expect(uidMatchesClaim('uid-1', 123)).toBe(false);
    expect(uidMatchesClaim('uid-1', { uid: 'uid-1' })).toBe(false);
  });
});

describe('registrantFromDecodedToken', () => {
  it('derives identity from the decoded token', () => {
    expect(
      registrantFromDecodedToken({ uid: 'u1', email: 'a@b.c', email_verified: true }),
    ).toEqual({ uid: 'u1', email: 'a@b.c', emailVerified: true });
  });

  it('treats missing email as null and missing verification as false', () => {
    expect(registrantFromDecodedToken({ uid: 'u1' })).toEqual({
      uid: 'u1',
      email: null,
      emailVerified: false,
    });
  });

  it('never reports verified unless the claim is exactly true', () => {
    expect(
      registrantFromDecodedToken({ uid: 'u1', email_verified: undefined }).emailVerified,
    ).toBe(false);
    expect(
      registrantFromDecodedToken({ uid: 'u1', email_verified: 'yes' as unknown as boolean }).emailVerified,
    ).toBe(false);
  });
});
