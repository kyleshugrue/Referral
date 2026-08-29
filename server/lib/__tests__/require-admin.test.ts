import { describe, expect, it, afterEach } from 'vitest';
import { isConfiguredAdministrator, requireAdmin } from '../../middleware/require-admin';

describe('administrator authorization', () => {
  const original = process.env.ADMIN_USER_IDS;

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = original;
  });

  it('fails closed when administrator configuration is missing', () => {
    delete process.env.ADMIN_USER_IDS;
    expect(isConfiguredAdministrator(7)).toBe(false);
  });

  it('fails closed when administrator configuration is malformed', () => {
    process.env.ADMIN_USER_IDS = '7,not-a-user';
    expect(isConfiguredAdministrator(7)).toBe(false);
  });

  it('matches only server-configured numeric user IDs', () => {
    process.env.ADMIN_USER_IDS = '7, 11';
    expect(isConfiguredAdministrator(7)).toBe(true);
    expect(isConfiguredAdministrator(11)).toBe(true);
    expect(isConfiguredAdministrator(12)).toBe(false);
  });

  it('returns 403 for a non-administrator and calls next for an administrator', () => {
    process.env.ADMIN_USER_IDS = '7';
    const next = () => undefined;
    let statusCode = 0;
    const response = {
      status: (code: number) => {
        statusCode = code;
        return response;
      },
      json: () => response,
    };

    const denied = requireAdmin(
      { user: { id: 8 }, path: '/admin', method: 'GET' } as never,
      response as never,
      next,
    );
    expect(denied).toBeUndefined();
    expect(statusCode).toBe(403);

    let called = false;
    requireAdmin(
      { user: { id: 7 }, path: '/admin', method: 'GET' } as never,
      response as never,
      () => {
        called = true;
      },
    );
    expect(called).toBe(true);
  });
});