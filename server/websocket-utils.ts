import { WebSocket } from 'ws';
import { logger } from './lib/logger';

// We need to access the connected clients map
export interface ConnectedClient {
  connectionId: string;
  ws: WebSocket;
  userId: number;
  lastPong: number;
  pingSentAt: number | null;
  pingTimeout?: NodeJS.Timeout;
  reconnectAttempts: number;
  firstConnectTime: number;
  platform?: string;
  authSessionId?: string;
  authKind?: 'jwt' | 'session' | 'ticket';
  sessionId?: string;
}

export type ConnectedClients = Map<number, Map<string, ConnectedClient>>;

// We'll need to reference external resources, so import from a getter function
let connectedClientsRef: ConnectedClients | null = null;

// Function to set the reference to connected clients
export function setConnectedClientsRef(clientsMap: ConnectedClients) {
  connectedClientsRef = clientsMap;
}

export function closeUserConnections(
  userId: number,
  selector?: { kind?: 'jwt' | 'session'; authSessionId?: string; sessionId?: string },
): void {
  const clients = connectedClientsRef?.get(userId);
  if (!clients) return;
  for (const [connectionId, client] of clients) {
    if (selector?.kind === 'jwt' && client.authKind !== 'jwt' && client.authKind !== 'ticket') continue;
    if (selector?.kind === 'session' && client.authKind !== 'session') continue;
    if (selector?.authSessionId && client.authSessionId !== selector.authSessionId) continue;
    if (selector?.sessionId && client.sessionId !== selector.sessionId) continue;
    clients.delete(connectionId);
    try {
      if (client.ws.readyState === WebSocket.OPEN || client.ws.readyState === WebSocket.CONNECTING) {
        client.ws.close(4001, 'Authorization revoked');
      }
    } catch (error) {
      logger.warn('[WebSocket Utils] Failed to close revoked connection', {
        userId,
        connectionId,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
  if (clients.size === 0) connectedClientsRef?.delete(userId);
}

/**
 * Get the number of currently connected clients
 * Used for health checks and monitoring
 */
export function getConnectedClientCount(): number {
  if (!connectedClientsRef) {
    return 0;
  }
  let count = 0;
  for (const clients of connectedClientsRef.values()) count += clients.size;
  return count;
}

/**
 * Send a connection request notification to a user
 * @param userId The ID of the user who should receive the notification
 * @param senderId The ID of the user who sent the connection request
 * @param requestId The ID of the connection request
 * @returns Promise that resolves to true if notification was sent, false otherwise
 */
export async function notifyConnectionRequest(userId: number, senderId: number, requestId: number): Promise<boolean> {
  return sendToUser(userId, {
      type: 'connectionRequest',
      requestId: requestId,
      senderId: senderId,
      userId: userId,
      timestamp: new Date().toISOString()
  });
}

/**
 * Send a connection request accepted notification to a user
 * @param userId The ID of the user who should receive the notification (original sender)
 * @param requestId The ID of the connection request that was accepted
 * @param acceptedById The ID of the user who accepted the request
 * @returns Promise that resolves to true if notification was sent, false otherwise
 */
export async function notifyConnectionAccepted(userId: number, requestId: number, acceptedById: number): Promise<boolean> {
  return sendToUser(userId, {
      type: 'connectionAccepted',
      requestId: requestId,
      acceptedById: acceptedById,
      userId: userId,
      timestamp: new Date().toISOString()
  });
}

export async function notifyConnectionRequestRejected(userId: number, requestId: number, rejectedById: number): Promise<boolean> {
  return sendToUser(userId, {
      type: 'connectionRejected',
      requestId: requestId,
      senderId: userId,           // The user who sent the original request (receiving this notification)
      rejectedById: rejectedById, // The user who rejected the request (remove from sender's cache)
      receivedRejection: true     // Flag to indicate this was received by the sender
  });
}

// Match event interfaces
interface MatchEventData {
  profileId: number;
  name: string;
  title?: string;
  company?: string;
  lastActive?: string;
  image?: string;
  matchDescription?: string;
}

interface MatchEvent {
  type: 'newMatch' | 'matchRefresh' | 'matchesUpdated';
  timestamp: string;
  matchData?: MatchEventData;
  sourceUserId?: number;
  profileVersion?: number;
  affectedCount?: number;
  message?: string;
}

/**
 * Broadcast a new match event to a specific user
 * @param userId The ID of the user to notify about the new match
 * @param matchData The match data to send
 * @returns Promise that resolves to true if notification was sent, false otherwise
 */
export async function broadcastNewMatch(userId: number, matchData: MatchEventData): Promise<boolean> {
  const event: MatchEvent = {
      type: 'newMatch',
      timestamp: new Date().toISOString(),
      matchData
  };
  return sendToUser(userId, event);
}

/**
 * Broadcast a match refresh event to a specific user (when matches need to be reloaded)
 * @param userId The ID of the user to notify about the match refresh
 * @returns Promise that resolves to true if notification was sent, false otherwise
 */
export async function broadcastMatchRefresh(userId: number): Promise<boolean> {
  const event: MatchEvent = {
      type: 'matchesUpdated',
      timestamp: new Date().toISOString(),
      message: 'Your matches have been updated'
  };
  return sendToUser(userId, event);
}

/**
 * Broadcast match refresh to multiple users
 * @param userIds Array of user IDs to notify
 * @returns Promise that resolves to the number of successful broadcasts
 */
export async function broadcastMatchRefreshToUsers(userIds: number[]): Promise<number> {
  if (!connectedClientsRef) {
    logger.error('[WebSocket Utils] Connected clients reference not set');
    return 0;
  }

  let successCount = 0;
  const promises = userIds.map(async (userId) => {
    const success = await broadcastMatchRefresh(userId);
    if (success) successCount++;
    return success;
  });

  await Promise.allSettled(promises);
  logger.debug(`[WebSocket Utils] Broadcast match refresh to ${successCount}/${userIds.length} users`);
  return successCount;
}

/**
 * Send a generic message to a specific user's WebSocket connection
 * @param userId The ID of the user to send the message to
 * @param message The message object to send (will be JSON stringified)
 * @returns Promise that resolves to true if message was sent, false otherwise
 */
export async function sendToUser(userId: number, message: unknown): Promise<boolean> {
  if (!connectedClientsRef) {
    logger.error('[WebSocket Utils] Connected clients reference not set');
    return false;
  }

  const clients = connectedClientsRef.get(userId);
  if (!clients || clients.size === 0) {
    logger.debug(`[WebSocket Utils] User ${userId} is not connected or socket not open`);
    return false;
  }

  const encodedMessage = JSON.stringify(message);
  let sent = false;
  for (const client of clients.values()) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    try {
      client.ws.send(encodedMessage);
      sent = true;
    } catch (error) {
      logger.error(`[WebSocket Utils] Error sending message to user ${userId}:`, error);
    }
  }
  if (sent) logger.debug(`[WebSocket Utils] Sent message to ${clients.size} connection(s) for user ${userId}`);
  return sent;
}