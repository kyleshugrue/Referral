import { describe, it, expect } from 'vitest';
import { verifyInternalAuth } from '../internal-auth';

describe('verifyInternalAuth', () => {
  const SECRET = 'super-secret-value';

  it('accepts the correct bearer secret', () => {
    expect(verifyInternalAuth(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(verifyInternalAuth('Bearer wrong-secret-value', SECRET)).toBe(false);
  });

  it('rejects secrets of different length without throwing', () => {
    expect(verifyInternalAuth('Bearer short', SECRET)).toBe(false);
    expect(verifyInternalAuth(`Bearer ${SECRET}extra`, SECRET)).toBe(false);
  });

  it('rejects missing or malformed headers', () => {
    expect(verifyInternalAuth(undefined, SECRET)).toBe(false);
    expect(verifyInternalAuth('', SECRET)).toBe(false);
    expect(verifyInternalAuth(SECRET, SECRET)).toBe(false); // no Bearer prefix
    expect(verifyInternalAuth(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it('rejects everything when the server has no secret configured', () => {
    expect(verifyInternalAuth(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(verifyInternalAuth('Bearer ', '')).toBe(false);
  });
});
