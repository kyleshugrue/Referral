import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCsrfToken, fetchWithCsrf, getCsrfToken } from '../csrf';

describe('csrf-aware client requests', () => {
  beforeEach(() => {
    clearCsrfToken();
    vi.restoreAllMocks();
  });

  it('fetches and attaches a token for browser mutations with bearer headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'session-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await fetchWithCsrf('/api/user', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ci-smoke-test-session-secret-not-used-anywhere-real' },
      body: JSON.stringify({ bio: 'updated' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestInit = fetchMock.mock.calls[1]?.[1];
    expect(new Headers(requestInit?.headers).get('X-CSRF-Token')).toBe('session-token');
  });

  it('does not request a token for safe methods', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await fetchWithCsrf('/api/user', { method: 'GET' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/user');
  });

  it('does not restore a token from a request started before the session was cleared', async () => {
    let resolveRequest!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(pendingResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'new-session-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const staleRequest = getCsrfToken();
    clearCsrfToken();
    resolveRequest(new Response(JSON.stringify({ csrfToken: 'old-session-token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(staleRequest).resolves.toBeNull();
    await expect(getCsrfToken()).resolves.toBe('new-session-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});