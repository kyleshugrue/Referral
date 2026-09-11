import { Capacitor } from '@capacitor/core';
import { config } from './config';

let csrfToken: string | null = null;
let csrfTokenRequest: Promise<string | null> | null = null;

function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export function clearCsrfToken(): void {
  csrfToken = null;
}

export async function getCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  if (csrfTokenRequest) return csrfTokenRequest;

  const csrfUrl = `${config.apiBaseUrl.replace(/\/+$/, '')}/api/csrf-token`;
  csrfTokenRequest = fetch(csrfUrl, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const body = await response.json() as { csrfToken?: unknown };
      csrfToken = typeof body.csrfToken === 'string' ? body.csrfToken : null;
      return csrfToken;
    })
    .catch(() => null)
    .finally(() => {
      csrfTokenRequest = null;
    });

  return csrfTokenRequest;
}

export async function getCsrfHeaders(method: string): Promise<Record<string, string>> {
  if (isSafeMethod(method)) return {};
  const token = await getCsrfToken();
  return token ? { 'X-CSRF-Token': token } : {};
}

export async function fetchWithCsrf(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!Capacitor.isNativePlatform()) {
    const csrfHeaders = await getCsrfHeaders(init.method ?? 'GET');
    Object.entries(csrfHeaders).forEach(([name, value]) => headers.set(name, value));
  }

  return fetch(input, { ...init, headers });
}