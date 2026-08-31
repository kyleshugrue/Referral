import { describe, expect, it } from 'vitest';
import {
  FirebaseAdminUnavailableError,
  isSyntheticSmokeTest,
  readFirebaseAdminConfig,
} from '../firebase-admin';

describe('Firebase Admin configuration', () => {
  const syntheticPrivateKey = [
    ['-----BEGIN', ' PRIVATE KEY-----'].join(''),
    '\\nYourPrivateKeyHere\\n',
    ['-----END', ' PRIVATE KEY-----'].join(''),
  ].join('');
  const malformedPrivateKey = 'not-a-private-key';
  const validEnvironment = {
    FIREBASE_PROJECT_ID: 'project-id',
    FIREBASE_CLIENT_EMAIL: 'firebase@example.invalid',
    FIREBASE_PRIVATE_KEY: syntheticPrivateKey,
    FIREBASE_STORAGE_BUCKET: 'gs://project-bucket',
  } as NodeJS.ProcessEnv;

  it('reads only server-side Firebase Admin configuration', () => {
    expect(readFirebaseAdminConfig(validEnvironment)).toEqual({
      projectId: 'project-id',
      clientEmail: 'firebase@example.invalid',
      privateKey: syntheticPrivateKey.replace(/\\n/g, '\n'),
      storageBucket: 'project-bucket',
    });
  });

  it('does not accept the browser project ID as an Admin project ID fallback', () => {
    expect(readFirebaseAdminConfig({
      VITE_FIREBASE_PROJECT_ID: 'browser-only-project',
      FIREBASE_CLIENT_EMAIL: 'firebase@example.invalid',
      FIREBASE_PRIVATE_KEY: validEnvironment.FIREBASE_PRIVATE_KEY,
    } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('rejects malformed private keys', () => {
    expect(() => readFirebaseAdminConfig({
      ...validEnvironment,
      FIREBASE_PRIVATE_KEY: malformedPrivateKey,
    } as NodeJS.ProcessEnv)).toThrow(/invalid format/);
  });

  it('uses a non-authenticating error when Admin is unavailable', () => {
    expect(new FirebaseAdminUnavailableError().message).toBe(
      'Firebase Admin authentication is unavailable',
    );
  });

  it('only enables the Firebase Admin bypass for the isolated CI smoke seam', () => {
    expect(isSyntheticSmokeTest({ CI: 'true', SMOKE_TEST: 'true' })).toBe(true);
    expect(isSyntheticSmokeTest({ CI: 'false', SMOKE_TEST: 'true' })).toBe(false);
    expect(isSyntheticSmokeTest({ CI: 'true', SMOKE_TEST: 'false' })).toBe(false);
    expect(isSyntheticSmokeTest({ SMOKE_TEST: 'true' })).toBe(false);
  });
});