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

export async function issueWebSocketTicket(userId: number, sessionId?: string): Promise<string> {
  const user = await storage.getUser(userId);
  if (!isActiveAccount(user)) {
    throw new Error('Account is not active');
  }
  const ticket = randomBytes(32).toString('base64url');
  await queryDatabase(
    pool,
    `INSERT INTO websocket_tickets (token_hash, user_id, session_id, audience, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashTicket(ticket), userId, sessionId ?? null, TICKET_AUDIENCE, new Date(Date.now() + TICKET_TTL_MS)],
  );
  return ticket;
}

export async function consumeWebSocketTicket(ticket: string): Promise<{ userId: number; sessionId: string | null } | null> {
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
  return result.rows[0] ? { userId: result.rows[0].user_id, sessionId: result.rows[0].session_id } : null;
}

export const websocketTicketTtlMs = TICKET_TTL_MS;