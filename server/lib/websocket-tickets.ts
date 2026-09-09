import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db';
import { queryDatabase } from './database-client';
import { storage } from '../storage';
import { isActiveAccount } from './account-status';

const TICKET_TTL_MS = 60_000;
const TICKET_AUDIENCE = 'websocket';

function hashTicket(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex');
}

export async function issueWebSocketTicket(
  userId: number,
  authorization?: { authSessionId?: string; sessionId?: string },
): Promise<string> {
  const user = await storage.getUser(userId);
  if (!isActiveAccount(user)) {
    throw new Error('Account is not active');
  }
  const ticket = randomBytes(32).toString('base64url');
  const authorizationMarker = authorization?.authSessionId
    ? `auth:${authorization.authSessionId}`
    : authorization?.sessionId
      ? `web:${authorization.sessionId}`
      : null;
  await queryDatabase(
    pool,
    `INSERT INTO websocket_tickets (token_hash, user_id, session_id, audience, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashTicket(ticket), userId, authorizationMarker, TICKET_AUDIENCE, new Date(Date.now() + TICKET_TTL_MS)],
  );
  return ticket;
}

export async function consumeWebSocketTicket(ticket: string): Promise<{
  userId: number;
  sessionId: string | null;
  authSessionId?: string;
} | null> {
  const result = await queryDatabase<{ user_id: number; session_id: string | null }>(
    pool,
    `UPDATE websocket_tickets
     SET used_at = NOW()
     WHERE token_hash = $1
       AND audience = $2
       AND used_at IS NULL
       AND expires_at > NOW()
     RETURNING user_id, session_id`,
    [hashTicket(ticket), TICKET_AUDIENCE],
  );
  const row = result.rows[0];
  if (!row) return null;
  const marker = row.session_id as string | null;
  if (marker?.startsWith('auth:')) {
    const authSessionId = marker.slice('auth:'.length);
    if (!await storage.isAuthSessionActive(row.user_id, authSessionId)) return null;
    return { userId: row.user_id, sessionId: null, authSessionId };
  }
  if (marker?.startsWith('web:')) {
    const sessionId = marker.slice('web:'.length);
    if (!await storage.isWebSessionActive(row.user_id, sessionId)) return null;
    return { userId: row.user_id, sessionId, };
  }
  return { userId: row.user_id, sessionId: marker };
}

export const websocketTicketTtlMs = TICKET_TTL_MS;