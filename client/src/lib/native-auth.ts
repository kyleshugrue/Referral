import { config } from './config';

export type RemoteRevocationStatus =
  | 'confirmed'
  | 'not_applicable'
  | 'unauthorized'
  | 'forbidden'
  | 'server_error'
  | 'http_error'
  | 'offline'
  | 'network_error';

export interface RemoteRevocationResult {
  status: RemoteRevocationStatus;
  httpStatus?: number;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Revoke the native JWT family through the configured backend origin.
 *
 * Local logout is intentionally handled by the caller before awaiting this
 * request. The access token is only ever held in the request body/header and
 * is never included in the result or logs.
 */
export async function revokeNativeSession(accessToken: string | null): Promise<RemoteRevocationResult> {
  if (!accessToken) {
    return { status: 'not_applicable' };
  }

  try {
    const response = await fetch(`${config.apiBaseUrl}/api/auth/revoke-all`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      credentials: 'include',
    });

    if (response.status === 401) return { status: 'unauthorized', httpStatus: response.status };
    if (response.status === 403) return { status: 'forbidden', httpStatus: response.status };
    if (response.status >= 500) return { status: 'server_error', httpStatus: response.status };
    if (!response.ok) return { status: 'http_error', httpStatus: response.status };
    return { status: 'confirmed', httpStatus: response.status };
  } catch {
    return {
      status: isOffline() ? 'offline' : 'network_error',
    };
  }
}