// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  savePendingRegistrationData,
  getPendingRegistrationData,
  saveRegistrationData,
  getRegistrationData,
  sanitizeRegistrationData,
} from '../registration-helpers';

const SENSITIVE_VALUE = 'S3cret-Passw0rd!';

/** Dumps every key/value currently in localStorage into one search string. */
function dumpLocalStorage(): string {
  let dump = '';
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    dump += `${key}=${localStorage.getItem(key)}\n`;
  }
  return dump;
}

beforeEach(() => {
  localStorage.clear();
});

describe('sanitizeRegistrationData never includes password fields', () => {
  it('strips password and confirmPassword from arbitrary input', () => {
    const safe = sanitizeRegistrationData({
      email: 'user@example.com',
      password: SENSITIVE_VALUE,
      confirmPassword: SENSITIVE_VALUE,
      fullName: 'Test User',
    });
    expect(safe).not.toHaveProperty('password');
    expect(safe).not.toHaveProperty('confirmPassword');
    expect(safe.email).toBe('user@example.com');
    expect(JSON.stringify(safe)).not.toContain(SENSITIVE_VALUE);
  });
});

describe('no password ever written to localStorage: fresh registration', () => {
  it('never persists a password when saving pending registration data', () => {
    savePendingRegistrationData({
      email: 'fresh@example.com',
      password: SENSITIVE_VALUE,
      confirmPassword: SENSITIVE_VALUE,
      fullName: 'Fresh User',
    });

    expect(dumpLocalStorage()).not.toContain(SENSITIVE_VALUE);

    const resumed = getPendingRegistrationData();
    expect(resumed).not.toBeNull();
    expect(resumed).not.toHaveProperty('password');
    expect(resumed?.email).toBe('fresh@example.com');
  });

  it('never persists a password when saving full registration data', () => {
    saveRegistrationData({
      email: 'full@example.com',
      password: SENSITIVE_VALUE,
      fullName: 'Full User',
    });

    expect(dumpLocalStorage()).not.toContain(SENSITIVE_VALUE);
    expect(getRegistrationData()).not.toHaveProperty('password');
  });
});

describe('no password ever written to localStorage: Google sign-in / resume / refresh', () => {
  it('does not reintroduce a password when updating already-saved pending data (simulated resume)', () => {
    // Simulate a Google sign-in flow where only profile fields (no password
    // ever exists) are captured, then the page is "refreshed" and resumed.
    savePendingRegistrationData({
      email: 'google-user@example.com',
      fullName: 'Google User',
      firebaseUid: 'uid-123',
    });

    // Resume after a simulated refresh: read it back exactly as a freshly
    // loaded page would.
    const afterRefresh = getPendingRegistrationData();
    expect(afterRefresh).not.toBeNull();
    expect(afterRefresh).not.toHaveProperty('password');
    expect(dumpLocalStorage()).not.toContain(SENSITIVE_VALUE);
  });

  it('strips a password even if a caller mistakenly includes one on update', () => {
    savePendingRegistrationData({ email: 'x@example.com' });
    // A defensive check: even if some future caller passes a password
    // through, the storage layer must still strip it before persisting.
    savePendingRegistrationData({ email: 'x@example.com', password: SENSITIVE_VALUE });

    expect(dumpLocalStorage()).not.toContain(SENSITIVE_VALUE);
    expect(getPendingRegistrationData()).not.toHaveProperty('password');
  });
});

describe('legacy pendingRegistrationData/registrationData full-object keys are migrated, not trusted as-is', () => {
  it('migrates a legacy unversioned pendingRegistrationData object and strips its password', () => {
    // Simulate a pre-fix write: the raw object (including a password) was
    // written directly to localStorage with no version/metadata envelope.
    localStorage.setItem(
      'pendingRegistrationData',
      JSON.stringify({ email: 'legacy@example.com', password: SENSITIVE_VALUE, fullName: 'Legacy User' })
    );

    const migrated = getPendingRegistrationData();
    expect(migrated).not.toBeNull();
    expect(migrated).not.toHaveProperty('password');
    expect(migrated?.email).toBe('legacy@example.com');

    // The migration must rewrite storage so the raw password never lingers.
    expect(dumpLocalStorage()).not.toContain(SENSITIVE_VALUE);
  });

  it('migrates a legacy unversioned registrationData object and strips its password', () => {
    localStorage.setItem(
      'registrationData',
      JSON.stringify({ email: 'legacy2@example.com', password: SENSITIVE_VALUE })
    );

    const migrated = getRegistrationData();
    expect(migrated).not.toHaveProperty('password');
    expect(dumpLocalStorage()).not.toContain(SENSITIVE_VALUE);
  });

  it('drops a legacy value that is only a bare password string wrapped as JSON', () => {
    // Pathological case: nothing usable survives sanitization, so the
    // migration should clear the key entirely rather than keep junk.
    localStorage.setItem('pendingRegistrationData', JSON.stringify({ password: SENSITIVE_VALUE }));

    const migrated = getPendingRegistrationData();
    expect(migrated).toBeNull();
    expect(localStorage.getItem('pendingRegistrationData')).toBeNull();
  });

  it('does not crash on a corrupted (non-JSON) legacy value and clears it', () => {
    localStorage.setItem('pendingRegistrationData', 'not-json-at-all{{{');
    expect(() => getPendingRegistrationData()).not.toThrow();
    expect(getPendingRegistrationData()).toBeNull();
    expect(localStorage.getItem('pendingRegistrationData')).toBeNull();
  });
});
