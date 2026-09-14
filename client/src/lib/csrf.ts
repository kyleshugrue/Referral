import { Capacitor } from '@capacitor/core';
import { config } from './config';

let csrfToken: string | null = null;
let csrfTokenRequest: Promise<string | null> | null = null;
let csrfGeneration = 0;

function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export function clearCsrfToken(): void {
  csrfGeneration += 1;
  csrfToken = null;
  csrfTokenRequest = null;
}

export async function getCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  if (csrfTokenRequest) return csrfTokenRequest;

  const requestGeneration = csrfGeneration;
  const csrfUrl = `${config.apiBaseUrl.replace(/\/+$/, '')}/api/csrf-token`;
  const request = fetch(csrfUrl, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const body = await response.json() as { csrfToken?: unknown };
      if (requestGeneration !== csrfGeneration) return null;
      csrfToken = typeof body.csrfToken === 'string' ? body.csrfToken : null;
      return csrfToken;
    })
    .catch(() => null)
    .finally(() => {
      if (csrfTokenRequest === request) csrfTokenRequest = null;
    });

  csrfTokenRequest = request;
  return csrfTokenRequest;
}

export async function getCsrfHeaders(method: string): Promise<Record<string, string>> {
  if (isSafeMethod(method)) return {};
  const requestGeneration = csrfGeneration;
  const token = await getCsrfToken();
  if (requestGeneration !== csrfGeneration) return {};
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