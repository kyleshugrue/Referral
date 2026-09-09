import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(() => 'ios'),
  isNativePlatform: vi.fn(() => true),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: mocks.getPlatform,
    isNativePlatform: mocks.isNativePlatform,
  },
}));

describe('native remote revocation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('uses the configured production origin and confirms only a 2xx response', async () => {
    const { revokeNativeSession } = await import('../native-auth');
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await expect(revokeNativeSession('access-token')).resolves.toEqual({
      status: 'confirmed',
      httpStatus: 204,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://referral-mobile-app-kylejshugrue.replit.app/api/auth/revoke-all',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer access-token' },
        credentials: 'include',
      }),
    );
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [500, 'server_error'],
    [409, 'http_error'],
  ] as const)('reports remote status %s as %s', async (status, result) => {
    const { revokeNativeSession } = await import('../native-auth');
    vi.mocked(fetch).mockResolvedValue(new Response('', { status }));

    await expect(revokeNativeSession('access-token')).resolves.toEqual({
      status: result,
      httpStatus: status,
    });
  });

  it('distinguishes offline and network failures without returning credentials', async () => {
    const { revokeNativeSession } = await import('../native-auth');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
    await expect(revokeNativeSession('access-token')).resolves.toEqual({ status: 'offline' });

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network'));
    await expect(revokeNativeSession('access-token')).resolves.toEqual({ status: 'network_error' });
  });
});