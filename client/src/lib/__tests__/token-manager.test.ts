import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  native: true,
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => mocks.platform,
    isNativePlatform: () => mocks.native,
  },
}));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    get: mocks.get,
    set: mocks.set,
    remove: mocks.remove,
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: mocks.toast,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type Manager = typeof import('../token-manager');

function jwt(expirySeconds = Math.floor(Date.now() / 1000) + 3600): string {
  const payload = btoa(JSON.stringify({ exp: expirySeconds }));
  return `header.${payload}.signature`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loadManager(): Promise<Manager> {
  vi.resetModules();
  return import('../token-manager');
}

async function seedTokens(manager: Manager, accessToken = jwt(), refreshToken = 'refresh-a') {
  mocks.get.mockResolvedValue(JSON.stringify({
    accessToken,
    refreshToken,
    deviceId: 'device-a',
    expiresAt: Date.now() + 3600000,
  }));
  await manager.setTokens({
    accessToken,
    refreshToken,
    deviceId: 'device-a',
    expiresAt: Date.now() + 3600000,
  });
}

describe('native token lifecycle fencing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.platform = 'ios';
    mocks.native = true;
    mocks.get.mockReset().mockResolvedValue(null);
    mocks.set.mockReset().mockResolvedValue(undefined);
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.toast.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [500, 'server_error'],
    [429, 'http_error'],
  ] as const)('distinguishes refresh HTTP status %s', async (status, outcome) => {
    const manager = await loadManager();
    await seedTokens(manager);
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status }));

    await expect(manager.refreshAccessToken()).resolves.toBeNull();

    expect(manager.getLastRefreshOutcome()).toBe(outcome);
    if (status >= 500 || status === 429) {
      expect(manager.getCurrentAccessToken()).not.toBeNull();
    } else {
      expect(manager.getCurrentAccessToken()).toBeNull();
    }
  });

  it('distinguishes malformed, offline, and network refresh failures without logging token data', async () => {
    const manager = await loadManager();
    await seedTokens(manager);

    vi.mocked(fetch).mockResolvedValueOnce(new Response('not-json', { status: 200 }));
    await expect(manager.refreshAccessToken()).resolves.toBeNull();
    expect(manager.getLastRefreshOutcome()).toBe('malformed_response');

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
    await expect(manager.refreshAccessToken()).resolves.toBeNull();
    expect(manager.getLastRefreshOutcome()).toBe('offline');

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network'));
    await expect(manager.refreshAccessToken()).resolves.toBeNull();
    expect(manager.getLastRefreshOutcome()).toBe('network_error');
  });

  it('does not let a delayed refresh resurrect credentials after logout', async () => {
    const manager = await loadManager();
    await seedTokens(manager);
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);

    const refreshing = manager.refreshAccessToken();
    await Promise.resolve();
    await manager.clearTokens();

    response.resolve(new Response(JSON.stringify({
      accessToken: jwt(),
      refreshToken: 'refresh-late',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await refreshing;

    expect(manager.getCurrentAccessToken()).toBeNull();
    expect(mocks.set).toHaveBeenCalledTimes(1);
  });

  it('prevents account A refresh completion from overwriting account B', async () => {
    const manager = await loadManager();
    await seedTokens(manager, jwt(), 'refresh-a');
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);
    const accountARefresh = manager.refreshAccessToken();
    await Promise.resolve();

    const accountBGeneration = manager.beginAuthSession();
    await manager.setTokensForGeneration({
      accessToken: jwt(),
      refreshToken: 'refresh-b',
      deviceId: 'device-b',
      expiresAt: Date.now() + 3600000,
    }, accountBGeneration);
    const accountBToken = manager.getCurrentAccessToken();

    response.resolve(new Response(JSON.stringify({
      accessToken: jwt(),
      refreshToken: 'refresh-a-late',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await accountARefresh;

    expect(manager.getCurrentAccessToken()).toBe(accountBToken);
    expect(manager.getLastRefreshOutcome()).toBe('stale');
  });

  it('invalidates a delayed SecureStorage load after logout', async () => {
    const manager = await loadManager();
    const stored = deferred<string | null>();
    mocks.get.mockReturnValueOnce(stored.promise);

    const loading = manager.loadTokens();
    await Promise.resolve();
    await manager.clearTokens();
    stored.resolve(JSON.stringify({
      accessToken: jwt(),
      refreshToken: 'refresh-late',
      deviceId: 'device-a',
      expiresAt: Date.now() + 3600000,
    }));

    await expect(loading).resolves.toBeNull();
    expect(manager.getCurrentAccessToken()).toBeNull();
  });

  it('serializes storage writes so logout removal follows an in-flight login write', async () => {
    const manager = await loadManager();
    const storageWrite = deferred<void>();
    mocks.set.mockReturnValueOnce(storageWrite.promise);

    const setting = manager.setTokens({
      accessToken: jwt(),
      refreshToken: 'refresh-a',
      deviceId: 'device-a',
      expiresAt: Date.now() + 3600000,
    });
    await Promise.resolve();
    const clearing = manager.clearTokens();

    expect(mocks.remove).not.toHaveBeenCalled();
    storageWrite.resolve();
    await Promise.all([setting, clearing]);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(manager.getCurrentAccessToken()).toBeNull();
  });

  it('cancels refresh timers on logout', async () => {
    const manager = await loadManager();
    await seedTokens(manager);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      accessToken: jwt(),
      refreshToken: 'refresh-late',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await manager.clearTokens();
    await vi.advanceTimersByTimeAsync(3600000);

    expect(fetch).not.toHaveBeenCalled();
  });
});