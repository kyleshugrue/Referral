import { Capacitor } from '@capacitor/core';
import { config } from './config';
import { getCurrentAccessToken } from './token-manager';

export async function openAuthenticatedWebSocket(url: string): Promise<WebSocket> {
  const endpoint = Capacitor.isNativePlatform()
    ? `${config.apiBaseUrl}/api/auth/ws-ticket`
    : '/api/auth/ws-ticket';
  const accessToken = getCurrentAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken && accessToken !== 'PENDING_REFRESH') {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers,
  });
  if (!response.ok) throw new Error('Unable to obtain WebSocket authentication ticket');
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('ticket' in payload) || typeof payload.ticket !== 'string') {
    throw new Error('Invalid WebSocket ticket response');
  }
  return new WebSocket(url, [`referral-ws-ticket.${payload.ticket}`]);
}